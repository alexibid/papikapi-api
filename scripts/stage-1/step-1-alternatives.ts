import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import type {
  AlternativesStepDefinition,
  FluxWorkerOutput,
  GenerateAlternativesRequest,
  GenerateAlternativesResponse,
} from './stage-1.interface.js';
import type { InlineImage, StepPrompts } from '../shared/common/interfaces/index.js';
import { TrainingReferences } from '../shared/common/training-references.js';
import { BodyPlans } from '../shared/common/body-plans.js';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { RunPodClient } from '../shared/common/runpod-client.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import { PromptEnricher } from '../shared/common/prompt-enricher.js';
import { PromptGuard } from '../shared/common/prompt-guard.js';
import { PromptRepository } from '../shared/common/prompt-repository.js';
import { PlaneColour } from './plane-colour.js';

export class AlternativesGenerator {
  private static readonly stepId = 's1-step-1';
  private static readonly maxSeed = 2 ** 31 - 1;

  private static randomSeeds(count: number): readonly number[] {
    return Array.from({ length: count }, () => randomInt(0, this.maxSeed));
  }

  /** The style LoRA is part of the studio look: a sheet made without it is refused, not kept. */
  private static assertLoraUsed(output: FluxWorkerOutput): string {
    if (!output.lora) throw new Error('FLUX worker generated without the style LoRA: publish the image with the LoRA first');
    return output.lora;
  }

  /** A worker that does not echo the seeds still runs fixed ones: refuse its sheet instead of reusing old art. */
  private static assertSeedsUsed(output: FluxWorkerOutput, seeds: readonly number[]): void {
    const used = output.seeds ?? [];
    if (used.length !== seeds.length || used.some((seed, index) => seed !== seeds[index])) {
      throw new Error('FLUX worker ignored the random seeds (outdated image): publish rp_handler.flux.py first');
    }
  }

  private static describeWorker(output: FluxWorkerOutput): string {
    if (output.reference_images_used === undefined) {
      return 'outdated image (no LoRA support, references ignored)';
    }
    const lora = output.lora ? `LoRA ${output.lora}` : 'no LoRA';
    return `${lora} · ${output.reference_images_used} reference image(s) used`;
  }

  private static loadStep(): AlternativesStepDefinition {
    return PipelineConfigLoader.getStep(this.stepId) as unknown as AlternativesStepDefinition;
  }

  public static composePrompt(subject: string, referenceCount: number, planeColour: string): string {
    const prompts = PromptRepository.forStep(this.stepId);
    const reference = referenceCount > 0 && prompts.referenceRule ? `${prompts.referenceRule} ` : '';
    const pose = this.poseOf(subject, prompts);
    const system = prompts.system.replaceAll('{plane_colour}', planeColour);
    const prompt = `${reference}${pose}${subject}. ${system}`;
    return PromptGuard.assertSystemBlock(PromptGuard.assertPrompt(prompt));
  }

  private static poseOf(subject: string, prompts: StepPrompts): string {
    if (PromptEnricher.needsSupport(subject) && prompts.supportedPose) {
      return `${prompts.supportedPose} `;
    }
    if (PromptEnricher.describesPose(subject) || !prompts.defaultPose) return '';
    const fourLegged = BodyPlans.isFourLegged(subject) && prompts.fourLeggedPose ? `${prompts.fourLeggedPose} ` : '';
    return `${prompts.defaultPose} ${fourLegged}`;
  }

  public static buildCellPrompts(subject: string, referenceCount: number, planeColour: string): string[] {
    const prompt = this.composePrompt(subject, referenceCount, planeColour);
    return Array.from({ length: this.loadStep().parameters.alternatives_count }, () => prompt);
  }

  private static composeReferenceImages(
    request: GenerateAlternativesRequest,
    maxSubjectImages: number,
  ): readonly InlineImage[] {
    const subjectImages = (request.referenceImages ?? []).slice(0, maxSubjectImages);
    // A style reference is used with the prompt alone; with subject photos only for four-legged animals, whose
    // photos (often sitting, seen from the front) otherwise turn them into figures standing on their hind legs.
    const wantsStyle = subjectImages.length === 0 || BodyPlans.isFourLegged(request.prompt);
    const style = wantsStyle ? TrainingReferences.findStyleImage(request.subject, request.prompt) : null;
    if (style) {
      const styleMessage = `🎨 Style Reference: ${style.item.file} (${style.item.name} in ${style.item.group})`;
      console.log(`  [s1-step-1] ${styleMessage}`);
      ProgressHub.report(request.name, this.stepId, styleMessage);
    }
    const subjectMessage = `📷 Subject Photos: ${subjectImages.length}`;
    console.log(`  [s1-step-1] ${subjectMessage}`);
    ProgressHub.report(request.name, this.stepId, subjectMessage);
    return style ? [style.image, ...subjectImages] : subjectImages;
  }

  private static saveReferences(stageDir: string, references: readonly InlineImage[]): void {
    references.forEach((image, index) => {
      const extension = image.mime.includes('png') ? 'png' : 'jpeg';
      writeFileSync(join(stageDir, `step-1-reference-${index + 1}.${extension}`), image.bytes);
    });
  }

  public static async execute(request: GenerateAlternativesRequest): Promise<GenerateAlternativesResponse> {
    const { name, subject, prompt: rawPrompt } = request;
    const enriched = PromptEnricher.enrichWithTraining(rawPrompt, subject);
    const prompt = PromptGuard.assertSubject(enriched);
    const step = this.loadStep();
    const params = step.parameters;
    const referenceImages = this.composeReferenceImages({ ...request, prompt }, params.max_reference_images);
    const planeColour = await PlaneColour.choose(prompt, referenceImages, params.plane_palette);
    const planeMessage = `🟫 Plane Colour: ${planeColour}`;
    console.log(`  [s1-step-1] ${planeMessage}`);
    ProgressHub.report(name, this.stepId, planeMessage);
    const fullPrompt = this.composePrompt(prompt, referenceImages.length, planeColour);

    let imageBytes: Buffer;
    let mime: string;
    let seconds: number;
    let costUsd: number;
    let costNote: string;
    let seeds: readonly number[] = [];
    let lora: string | null = null;

    const contract = step.manifest_contract;
    const config = PipelineConfigLoader.load();
    const pricing = config.pricing as { runpod_flux_usd_per_sec?: number };
    const fluxRate = pricing.runpod_flux_usd_per_sec ? pricing.runpod_flux_usd_per_sec : 0.00015;

    try {
      const envKey = step.serverless ? step.serverless.env_endpoint_key : 'RUNPOD_FLUX_ENDPOINT_ID';
      const endpointId = RunPodClient.getEndpointId(envKey);

      seeds = this.randomSeeds(params.columns * params.rows);
      const payload = {
        seeds,
        prompt: fullPrompt,
        cell_prompts: this.buildCellPrompts(prompt, referenceImages.length, planeColour),
        reference_images: referenceImages.map((img) => img.bytes.toString('base64')),
        columns: params.columns,
        rows: params.rows,
      };

      const startMsg = step.messages?.start ? step.messages.start.replace('{model}', name) : `[Stage 1: Step 1] Generating 3x2 alternatives sheet for ${name}`;
      console.log(`\n  \x1b[35m${startMsg}\x1b[0m`);
      ProgressHub.report(name, this.stepId, startMsg);

      const result = await RunPodClient.execute<typeof payload, FluxWorkerOutput>(
        endpointId,
        payload,
        {
          timeoutMs: (step.serverless?.client_timeout_seconds ?? 900) * 1000,
          purgeBeforeRun: true,
          maxRetries: 0,
          onProgress: (update) => {
            const state = update.status === 'IN_QUEUE' ? 'Na fila de espera' : 'A processar';
            const progressMsg = `⟳ [RunPod Serverless] Generating alternatives on FLUX.2 Serverless Worker... (${state}, ${update.elapsedSeconds}s elapsed)`;
            ProgressHub.report(name, this.stepId, progressMsg);
          },
        }
      );
      const workerMessage = `🧩 Worker: ${this.describeWorker(result.output)}`;
      console.log(`  [${this.stepId}] ${workerMessage}`);
      ProgressHub.report(name, this.stepId, workerMessage);
      this.assertSeedsUsed(result.output, seeds);
      lora = this.assertLoraUsed(result.output);
      imageBytes = Buffer.from(result.output.sheet_base64, 'base64');
      mime = result.output.mime ? result.output.mime : 'image/jpeg';
      seconds = result.seconds;
      costUsd = Math.round(seconds * fluxRate * 10000) / 10000;
      costNote = `RunPod Serverless FLUX.2 ($${costUsd.toFixed(4)})`;
    } catch (err) {
      const errMessage = (err as Error).message;
      console.error(`  \x1b[31m[${this.stepId}] ❌ Generation failed: ${errMessage}\x1b[0m`);
      throw new Error(`Falha na geração FLUX: ${errMessage}`);
    }

    const stage0Dir = join(WorkspacePaths.resourcePath(name), step.stage_dir);
    const publicDir = WorkspacePaths.modelPath(name);
    mkdirSync(stage0Dir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });

    const ext = mime.includes('png') ? 'png' : 'jpeg';
    const resourceFile = join(stage0Dir, step.outputs.sheet_resource.replace(/\.[^/.]+$/, `.${ext}`));
    const publicFile = join(publicDir, step.outputs.sheet_public.replace(/\.[^/.]+$/, `.${ext}`));

    for (const fileExt of step.outputs.allowed_extensions) {
      const resBase = step.outputs.sheet_resource.replace(/\.[^/.]+$/, '');
      const oldRes = join(stage0Dir, `${resBase}${fileExt}`);
      if (existsSync(oldRes)) unlinkSync(oldRes);
      const pubBase = step.outputs.sheet_public.replace(/\.[^/.]+$/, '');
      const oldPub = join(publicDir, `${pubBase}${fileExt}`);
      if (existsSync(oldPub)) unlinkSync(oldPub);
    }

    writeFileSync(resourceFile, imageBytes);
    writeFileSync(publicFile, imageBytes);
    this.saveReferences(stage0Dir, referenceImages);

    ManifestManager.writeStepResult(name, this.stepId, {
      status: contract.status,
      seconds,
      costUsd,
      costNote,
      data: {
        prompt,
        fluxPrompt: fullPrompt,
        seeds,
        lora,
        referenceCount: referenceImages.length,
        planeColour,
        alternativesCount: params.alternatives_count,
        format: mime,
      },
    });

    return {
      name,
      prompt,
      resourcePath: resourceFile,
      publicPath: step.outputs.public_url_pattern.replace('{model}', name).replace(/\.[^/.]+$/, `.${ext}`),
      seconds,
      costUsd,
    };
  }
}
