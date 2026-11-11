import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CatalogueManager } from '../common/catalogue-manager.js';
import { FigureReport } from '../report/figure-report.js';
import { CliArgsParser } from '../common/cli-args-parser.js';
import { ImageMime } from '../common/image-mime.js';
import type {
  InlineImage,
  ModelExecutionReport,
  PipelineStep,
  StepExecutionResult,
} from '../common/interfaces/index.js';
import { ModelRow } from '../common/model-row.js';
import { FigureCleaner } from '../common/figure-cleaner.js';
import { OutputCleaner } from '../common/output-cleaner.js';
import { PipelineConfigLoader } from '../common/pipeline-config.js';
import { ProgressHub } from '../common/progress-hub.js';
import { PromptRepository } from '../common/prompt-repository.js';
import { ReferenceImageRepository } from '../common/reference-image-repository.js';
import { QuietConsole } from '../common/quiet-console.js';
import { StageReporter } from '../common/stage-reporter.js';
import { StepInputs } from '../common/step-inputs.js';
import { WorkspacePaths } from '../common/workspace-paths.js';
import type { CliArguments } from './orchestrator.interface.js';
import { AlternativesGenerator } from '../../stage-1/step-1-alternatives.js';
import { AlternativePicker } from '../../stage-1/step-2-pick.js';
import { ArtUpscaler } from '../../stage-1/step-3-upscale.js';
import { TrellisInputGenerator } from '../../stage-2/step-1-trellis-input.js';
import { TrellisGenerator } from '../../stage-2/step-2-trellis.js';
import { SimplifyGenerator } from '../../stage-3/step-1-simplify.js';
import { TrellisAtlasGenerator } from '../../stage-3/step-2-trellis-atlas.js';
import { AtlasGenerator } from '../../stage-3/step-3-atlas.js';
import { TexturizeGenerator } from '../../stage-3/step-4-texturize.js';
import { PlinthGenerator } from '../../stage-3/step-5-plinth.js';
import { PreviewsGenerator } from '../../stage-3/step-6-previews.js';
import { UnfoldGenerator } from '../../stage-4/step-1-unfold.js';
import { SheetsExporter } from '../../stage-4/step-2-sheets.js';
import { AssemblyGenerator } from '../../stage-5/step-1-assembly.js';
import { FigureRegistry } from '../common/figure-registry.js';
import { CreatorService } from '../server/creator-service.js';

export class StageOrchestrator {
  private static discoverModels(pattern: string): readonly string[] {
    const position = pattern.split('/').indexOf('*');
    const matches = globSync(pattern, { cwd: WorkspacePaths.appRoot });
    const names = matches.map((m) => m.split('/')[position]);
    return [...new Set(names)].sort();
  }

  private static resolveTargetModels(
    flags: CliArguments,
    activeSteps: readonly PipelineStep[],
  ): readonly string[] {
    if (flags.model) return [flags.model.trim()];
    const config = PipelineConfigLoader.load();
    const pattern = activeSteps[0]?.models_from ?? config.workspace.models_from;
    return this.discoverModels(pattern);
  }

  private static resolveFigurePrompt(model: string, promptFromFlag: string | null): string {
    if (promptFromFlag === null) return PromptRepository.forFigure(model);
    this.registerFigure(model, promptFromFlag);
    PromptRepository.saveFigure(model, 's1-step-1', promptFromFlag);
    return promptFromFlag;
  }

  private static registerFigure(model: string, prompt: string): void {
    if (FigureRegistry.hasDisplayName(model)) return;
    const subject = CreatorService.deriveSubject(prompt) || model;
    const name = FigureRegistry.humanize(subject);
    FigureRegistry.register({ id: model, subject, displayName: { pt: name, en: name } });
  }

  private static loadReferenceImage(path: string): InlineImage {
    const candidates = [
      isAbsolute(path) ? path : resolve(process.cwd(), path),
      resolve(WorkspacePaths.workspaceRoot, path),
      resolve(WorkspacePaths.appRoot, path),
    ];
    const refPath = candidates.find((candidate) => existsSync(candidate));
    if (!refPath) throw new Error(`Reference image not found: ${path}`);
    const bytes = readFileSync(refPath);
    const mime = ImageMime.of(bytes);
    console.log(`  [s1-step-1] Visual Reference: ${refPath} (${mime}, ${(bytes.length / 1024).toFixed(1)} KB)`);
    return { bytes, mime };
  }

  private static loadReferenceImages(model: string, refFromFlag: string | null): readonly InlineImage[] {
    const paths = refFromFlag !== null ? [refFromFlag] : ReferenceImageRepository.paths(model);
    return paths.map((path) => this.loadReferenceImage(path));
  }

  public static async run(): Promise<void> {
    const flags = CliArgsParser.parse();
    const fullPipelineSteps = PipelineConfigLoader.load().pipeline_stages.flatMap((s) => s.steps);
    const targetStages =
      flags.stage !== null
        ? [PipelineConfigLoader.getStage(flags.stage)]
        : PipelineConfigLoader.load().pipeline_stages;
    const allSteps = targetStages.flatMap((s) => s.steps);
    let activeSteps: readonly PipelineStep[];
    if (flags.step) {
      activeSteps = allSteps.filter((s) => s.id === flags.step);
    } else if (flags.fromStep) {
      const idx = allSteps.findIndex((s) => s.id === flags.fromStep);
      if (idx === -1) {
        throw new Error(`Step '${flags.fromStep}' not found in pipeline`);
      }
      activeSteps = allSteps.slice(idx);
    } else {
      activeSteps = allSteps;
    }

    if (activeSteps.length === 0) {
      throw new Error(`No matching steps found for stage ${flags.stage} and step ${flags.step ?? flags.fromStep}`);
    }

    const allPipelineStages = PipelineConfigLoader.load().pipeline_stages;
    const stageTitle =
      targetStages.length === allPipelineStages.length
        ? 'Full Pipeline (Stage 1 → Stage 5)'
        : targetStages.length > 1
          ? targetStages.map((s) => s.stage.split(':')[0]).join(' → ')
          : targetStages[0].stage;

    const models = this.resolveTargetModels(flags, activeSteps);
    StageReporter.printHeader(stageTitle, models.length);

    const reports: ModelExecutionReport[] = [];

    for (let mIdx = 0; mIdx < models.length; mIdx++) {
      const model = models[mIdx];
      const stepResults: StepExecutionResult[] = [];
      let modelPassed = true;
      let figureCleaned = false;
      const modelStart = Date.now();

      const label = `[${String(mIdx + 1).padStart(2, '0')}/${String(models.length).padStart(2, '0')}] ${model.toUpperCase()}`;
      const firstActiveIdx = fullPipelineSteps.findIndex((s) => s.id === activeSteps[0].id);
      const slotInits = fullPipelineSteps.map((s, idx) => ({
        label: s.label,
        status: (idx < firstActiveIdx ? 'DONE' : 'PENDING') as 'DONE' | 'PENDING',
      }));
      const row = new ModelRow(label, slotInits);

      let failureLines: readonly string[] = [];
      ProgressHub.begin(model, activeSteps.map((s) => s.id));
      const unsubscribeProgress = ProgressHub.subscribe(model, (event) => {
        if (event.message) {
          row.subStatus(event.message);
        }
      });
      row.begin();

      for (const step of activeSteps) {
        const [reason] = StepInputs.skipReasons(model, step, flags);
        if (reason !== undefined) {
          stepResults.push({
            stepId: step.id,
            label: step.label,
            status: 'SKIP',
            duration: 0,
            message: reason,
          });
          row.finish(step.label, 'SKIP', 0);
          continue;
        }
        row.running(step.label);
        QuietConsole.start();
        if (!figureCleaned) {
          FigureCleaner.cleanFrom(model, step);
          figureCleaned = true;
        }
        OutputCleaner.clean(model, step);
        const stepStart = Date.now();
        let status: 'DONE' | 'FAIL' = 'DONE';
        let errMsg = '';

        try {
          if (step.id === 's1-step-1') {
            const prompt = this.resolveFigurePrompt(model, flags.prompt);
            console.log(`  [s1-step-1] Input Prompt: "${prompt}"`);
            const res = await AlternativesGenerator.execute({
              name: model,
              subject: FigureRegistry.identityOf(model).subject,
              prompt,
              referenceImages: this.loadReferenceImages(model, flags.ref),
            });
            const size = statSync(res.resourcePath).size;
            console.log(
              `  [s1-step-1] Output Sheet: ${res.resourcePath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's1-step-2') {
            const pickStep = PipelineConfigLoader.getStep('s1-step-2');
            const defaultPick = (pickStep.parameters as { default_pick: number }).default_pick ?? 3;
            let pick = flags.pick;
            if (pick === null && (process.stdin.isTTY || process.stdout.isTTY)) {
              QuietConsole.stop();
              row.clearSub();
              process.stdout.write('\x1b[?25h');
              process.stdout.write(
                `\n  \x1b[33m🖼️  As 6 alternativas estão em: public/models/${model}/alternatives.jpeg\x1b[0m\n`,
              );
              const rl = createInterface({ input: process.stdin, output: process.stdout });
              const ans = await rl.question(
                `  \x1b[36m👉 Escolhe a alternativa desejada (1-6) [default: ${defaultPick}]: \x1b[0m`,
              );
              rl.close();
              const parsed = Number.parseInt(ans.trim(), 10);
              pick = !Number.isNaN(parsed) && parsed >= 1 && parsed <= 6 ? parsed : defaultPick;
              process.stdout.write('\x1b[1A\r\x1b[2K\x1b[1A\r\x1b[2K\x1b[1A\r\x1b[2K\x1b[?25l');
              QuietConsole.start();
              row.subStatus(`Alternativa ${pick} selecionada`);
            } else if (pick === null) {
              pick = defaultPick;
            }
            flags.pick = pick;
            const res = await AlternativePicker.execute({
              name: model,
              pick,
            });
            const size = statSync(res.resourceArtPath).size;
            console.log(
              `  [s1-step-2] Output Art: ${res.resourceArtPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's1-step-3') {
            const res = await ArtUpscaler.execute({ name: model });
            const size = statSync(res.upscaledPath).size;
            console.log(`  [s1-step-3] Output Upscaled Art: ${res.upscaledPath} (${(size / 1024).toFixed(1)} KB)`);
          } else if (step.id === 's2-step-1') {
            const res = await TrellisInputGenerator.execute({ name: model });
            const size = statSync(res.trellisInputPath).size;
            console.log(
              `  [s2-step-1] Output TRELLIS input: ${res.trellisInputPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's2-step-2') {
            const trellisStep = PipelineConfigLoader.getStep('s2-step-2') as unknown as {
              inputs: { stage_dir: string; trellis_input_resource: string };
            };
            const cutoutPath = join(
              WorkspacePaths.resourcePath(model),
              trellisStep.inputs.stage_dir,
              trellisStep.inputs.trellis_input_resource,
            );
            const cutoutSize = existsSync(cutoutPath) ? statSync(cutoutPath).size : 0;
            console.log(
              `  [s2-step-2] Input Cutout: ${cutoutPath} (${(cutoutSize / 1024).toFixed(1)} KB)`,
            );
            const res = await TrellisGenerator.execute(
              model,
              flags.pick !== null ? flags.pick : undefined,
            );
            const size = statSync(res.outputPath).size;
            console.log(
              `  [s2-step-2] Output 3D Mesh: ${res.outputPath} (${(size / (1024 * 1024)).toFixed(2)} MB)`,
            );
            CatalogueManager.sync();
          } else if (step.id === 's3-step-1') {
            const res = await SimplifyGenerator.execute(
              model,
              flags.pick !== null ? flags.pick : undefined,
            );
            const size = statSync(res.modelPath).size;
            console.log(
              `  [s3-step-1] Output Simplified Mesh: ${res.pointsPath} and ${res.modelPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's3-step-2') {
            const res = await TrellisAtlasGenerator.execute(model);
            console.log(`  [s3-step-2] Output TRELLIS Atlas: ${res.atlasPath}`);
          } else if (step.id === 's3-step-3') {
            const res = await AtlasGenerator.execute(model);
            const size = statSync(res.atlasPath).size;
            console.log(
              `  [s3-step-3] Output Texture Atlas: ${res.atlasPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's3-step-4') {
            const res = await TexturizeGenerator.execute(model);
            const size = statSync(res.modelPath).size;
            console.log(
              `  [s3-step-4] Output Textured Model: ${res.modelPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's3-step-5') {
            const res = await PlinthGenerator.execute(model);
            const size = statSync(res.modelPath).size;
            console.log(
              `  [s3-step-5] Output Model With Plinth: ${res.modelPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's3-step-6') {
            const res = await PreviewsGenerator.execute(model);
            console.log(`  [s3-step-6] Output Previews: ${res.previewPaths.join(', ')}`);
          } else if (step.id === 's4-step-1') {
            const res = await UnfoldGenerator.execute(model);
            const size = statSync(res.outputPath).size;
            console.log(
              `  [s4-step-1] Output Net: ${res.outputPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's4-step-2') {
            const res = await SheetsExporter.execute(model);
            const size = statSync(res.outputPath).size;
            console.log(
              `  [s4-step-2] Output Sheets: ${res.outputPath} (${(size / 1024).toFixed(1)} KB)`,
            );
          } else if (step.id === 's5-step-1') {
            const res = await AssemblyGenerator.execute(model);
            if (existsSync(res.outputPath)) {
              const size = statSync(res.outputPath).size;
              console.log(
                `  [s5-step-1] Output Assembly Plan: ${res.outputPath} (${(size / 1024).toFixed(1)} KB)`,
              );
            } else {
              console.log(`  [s5-step-1] Output Assembly Plan saved to SQLite (${res.outputPath})`);
            }
          }
        } catch (err) {
          status = 'FAIL';
          modelPassed = false;
          errMsg = (err as Error).message;
          console.error(`  ❌ Step error: ${errMsg}`);
        }

        const captured = QuietConsole.stop();
        const duration = (Date.now() - stepStart) / 1000;
        stepResults.push({
          stepId: step.id,
          label: step.label,
          status,
          duration,
          message: errMsg,
        });

        row.finish(step.label, status, duration);
        if (!modelPassed) {
          failureLines = captured;
          break;
        }
      }

      if (modelPassed) {
        OutputCleaner.purgeNonMediaFiles(model);
      }

      unsubscribeProgress();
      ProgressHub.finish(model);
      const totalDuration = (Date.now() - modelStart) / 1000;
      row.end(totalDuration, modelPassed, failureLines);
      reports.push({
        modelName: model,
        stepResults,
        totalDuration,
        passed: modelPassed,
      });

      CatalogueManager.sync();
    }

    StageReporter.printSummary(reports);
    await this.writeReport();
  }

  /** The review PDF in resources/ follows every run; a report that fails to render never fails the run. */
  private static async writeReport(): Promise<void> {
    try {
      console.log(`  Report: ${await FigureReport.write()}`);
    } catch (error) {
      console.warn(`  Report not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('stage-orchestrator.ts')) {
  void StageOrchestrator.run().catch((err) => {
    console.error(`\n[Fatal Error] ${(err as Error).message}\n`);
    process.exit(1);
  });
}
