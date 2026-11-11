import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { RunPodClient } from '../shared/common/runpod-client.js';
import { RunPodStreamClient } from '../shared/common/runpod-stream-client.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import type {
  TrellisAttempt,
  ChosenAttempt,
  TrellisGateVerdict,
  TrellisQualityGate,
  TrellisRequest,
  TrellisGenerateResponse,
  TrellisStreamChunk,
  TrellisStreamPart,
  TrellisStepDefinition,
} from './interfaces/trellis.interface.js';

export class TrellisGenerator {
  private static readonly stepId = 's2-step-2';

  private static findTrellisInput(modelName: string, step: TrellisStepDefinition): string {
    const inputPath = join(
      WorkspacePaths.resourcePath(modelName),
      step.inputs.stage_dir,
      step.inputs.trellis_input_resource,
    );
    if (!existsSync(inputPath)) {
      throw new Error(`TRELLIS input not found for '${modelName}': run s1-step-3 first (${inputPath})`);
    }
    return inputPath;
  }

  private static readonly maxSeed = 2_147_483_647;
  private static readonly transportAttempts = 3;

  /** Same as the official Space's "Randomize Seed": a fresh seed per run, kept in the manifest to reproduce it. */
  private static resolveSeed(seed: number | 'random'): number {
    return seed === 'random' ? randomInt(0, this.maxSeed) : seed;
  }

  /** A worker that does not report the seed it ran cannot be trusted to have used the random one. */
  private static assertSeedUsed(chunks: readonly TrellisStreamChunk[], seed: number): void {
    const reported = new Set(chunks.filter((chunk) => chunk.part === 'glb').map((chunk) => chunk.seed));
    if (reported.size !== 1 || !reported.has(seed)) {
      throw new Error(`TRELLIS worker used seed [${[...reported].join()}] instead of ${seed}`);
    }
  }

  private static assemblePart(chunks: readonly TrellisStreamChunk[], part: TrellisStreamPart): Buffer {
    const failure = chunks.find((chunk) => chunk.error);
    if (failure) {
      throw new Error(failure.error);
    }
    const pieces = chunks.filter((chunk) => chunk.part === part).sort((left, right) => left.chunk_index - right.chunk_index);
    if (pieces.length === 0 || pieces.length !== pieces[0].chunk_count) {
      throw new Error(`${part} stream incomplete: received ${pieces.length} of ${pieces[0]?.chunk_count ?? '?'} chunks`);
    }
    const buffer = Buffer.from(pieces.map((chunk) => chunk.data).join(''), 'base64');
    if (buffer.length !== pieces[0].file_size) {
      throw new Error(`${part} stream corrupted: ${buffer.length} bytes instead of ${pieces[0].file_size}`);
    }
    return buffer;
  }

  private static judge(gate: TrellisQualityGate, glbPath: string, cutoutPath: string): TrellisGateVerdict {
    const outcome = spawnSync('python3', [
      join(WorkspacePaths.appRoot, gate.python_script), '--glb', glbPath, '--cutout', cutoutPath,
      '--settings', JSON.stringify(gate),
    ], { encoding: 'utf8' });
    if (outcome.status !== 0) {
      throw new Error(`TRELLIS quality gate failed to run: ${outcome.stderr}`);
    }
    return JSON.parse(outcome.stdout.trim()) as TrellisGateVerdict;
  }

  private static async generateOnce(request: TrellisRequest, seed: number): Promise<TrellisAttempt> {
    const { step, modelName, endpointId, usdPerSec, inputPath } = request;
    const settings = {
      seed,
      resolution: step.parameters.resolution,
      decimation_target: step.parameters.decimation_target,
      texture_size: step.parameters.texture_size,
    };
    const uploaded = await sharp(inputPath).png().toBuffer();
    const payload = { image_base64: uploaded.toString('base64'), ...settings };
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.transportAttempts; attempt++) {
      try {
        const result = await RunPodStreamClient.execute<typeof payload, TrellisStreamChunk>(endpointId, payload, {
          timeoutMs: step.serverless.client_timeout_seconds * 1000,
          onProgress: (update) => this.reportProgress(step, modelName, update),
        });
        this.assertSeedUsed(result.chunks, seed);
        return {
          glb: this.assemblePart(result.chunks, 'glb'),
          preview: this.assemblePart(result.chunks, 'preview'),
          seconds: result.seconds,
          costUsd: Math.round(result.seconds * usdPerSec * 10000) / 10000,
          faceCount: result.chunks.find((chunk) => chunk.part === 'glb')?.face_count ?? 0,
          settings,
        };
      } catch (trellisErr) {
        lastError = trellisErr as Error;
        console.warn(`  [${this.stepId}] TRELLIS call ${attempt}/${this.transportAttempts} failed: ${lastError.message}`);
        if (attempt < this.transportAttempts) await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
    throw new Error(`Falha na geração 3D Trellis: ${lastError?.message ?? 'Unknown Trellis error'}`);
  }

  private static reportProgress(step: TrellisStepDefinition, modelName: string, update: { status: string; elapsedSeconds: number }): void {
    const runnerState = update.status === 'IN_QUEUE' ? 'Na fila de espera' : step.runner.device;
    ProgressHub.report(modelName, this.stepId, step.messages.progress
      .replace('{runner}', step.runner.platform)
      .replace('{device}', runnerState)
      .replace('{elapsed}', String(update.elapsedSeconds)));
  }

  /** New seeds until a model passes the gate; when none does, the best scored one is kept and the verdict says so. */
  private static async bestAttempt(request: TrellisRequest, candidatePath: string): Promise<ChosenAttempt> {
    const gate = request.step.parameters.quality_gate;
    const cutoutPath = request.inputPath;
    const tried: { attempt: TrellisAttempt; verdict: TrellisGateVerdict }[] = [];
    for (let round = 1; round <= gate.max_attempts; round++) {
      const attempt = await this.generateOnce(request, this.resolveSeed(request.step.parameters.seed));
      writeFileSync(candidatePath, attempt.glb);
      const verdict = this.judge(gate, candidatePath, cutoutPath);
      const message = `🔎 Seed ${attempt.settings.seed}: ${verdict.passed ? 'aprovado' : verdict.reasons.join('; ')}`;
      console.log(`  [${this.stepId}] ${message}`);
      ProgressHub.report(request.modelName, this.stepId, message);
      tried.push({ attempt, verdict });
      if (verdict.passed) break;
    }
    unlinkSync(candidatePath);
    const best = [...tried].sort((left, right) => right.verdict.score - left.verdict.score)[0];
    return {
      ...best,
      history: tried.map(({ attempt, verdict }) => ({ seed: attempt.settings.seed, ...verdict })),
      seconds: tried.reduce((total, { attempt }) => total + attempt.seconds, 0),
      costUsd: tried.reduce((total, { attempt }) => total + attempt.costUsd, 0),
    };
  }

  public static async execute(modelName: string, requestedPick?: number): Promise<TrellisGenerateResponse> {
    const step = PipelineConfigLoader.getStep(this.stepId) as unknown as TrellisStepDefinition;
    const stageDir = join(WorkspacePaths.resourcePath(modelName), step.stage_dir);
    const publicDir = WorkspacePaths.modelPath(modelName);
    mkdirSync(stageDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    const pick = requestedPick ?? ManifestManager.readStepResult(modelName, 's1-step-2')?.data?.chosenPick;
    const contract = step.manifest_contract;
    const outputPath = join(stageDir, step.outputs.model_resource);
    const runner = step.runner;
    const config = PipelineConfigLoader.load();
    if (existsSync(outputPath)) unlinkSync(outputPath);

    const envKey = step.serverless.env_endpoint_key ? step.serverless.env_endpoint_key : 'RUNPOD_TRELLIS_ENDPOINT_ID';
    const request: TrellisRequest = {
      step, modelName,
      endpointId: RunPodClient.getEndpointId(envKey),
      usdPerSec: Number(config.pricing.runpod_trellis_usd_per_sec),
      inputPath: this.findTrellisInput(modelName, step),
    };
    const startMsg = step.messages.start.replace('{model}', modelName);
    console.log(`\n  \x1b[35m${startMsg}\x1b[0m`);
    ProgressHub.report(modelName, this.stepId, startMsg);

    const chosen = await this.bestAttempt(request, join(stageDir, 'step-2-3d-candidate.glb'));
    const { glb: buffer, settings, faceCount } = chosen.attempt;
    const duration = Math.round(chosen.seconds * 100) / 100;
    const costUsd = Math.round(chosen.costUsd * 10000) / 10000;
    await sharp(chosen.attempt.preview).webp({ lossless: true }).toFile(join(stageDir, step.outputs.preview_resource));
    writeFileSync(outputPath, buffer);
    writeFileSync(join(publicDir, step.outputs.model_public), buffer);
    if (pick) {
      writeFileSync(join(stageDir, step.outputs.model_pick_resource_pattern.replace('{pick}', String(pick))), buffer);
    }

    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);

    const completedMsg = step.messages.completed
      .replace('{runner}', runner.platform)
      .replace('{sizeMb}', sizeMb)
      .replace('{duration}', String(duration))
      .replace('{costUsd}', costUsd.toFixed(4));
    console.log(`  \x1b[32m${completedMsg}\x1b[0m\n`);
    ProgressHub.report(modelName, this.stepId, completedMsg);

    ManifestManager.writeStepResult(modelName, this.stepId, {
      status: contract.status,
      seconds: duration,
      costUsd,
      costNote: contract.costNote,
      metrics: {
        fileSize: buffer.length,
        faceCount,
        gatePassed: chosen.verdict.passed,
        silhouetteOverlap: chosen.verdict.overlap,
        solidParts: chosen.verdict.parts,
        seedsTried: chosen.history.length,
      },
      data: {
        fileSize: buffer.length,
        faceCount,
        format: contract.data.format,
        cached: false,
        chosenPick: pick ?? null,
        device: contract.data.device,
        parameters: settings,
        qualityGate: chosen.history,
      },
    });

    return {
      name: modelName,
      outputPath,
      publicPath: step.outputs.public_url_pattern.replace('{model}', modelName),
      seconds: duration,
      costUsd,
      cached: false,
    };
  }
}
