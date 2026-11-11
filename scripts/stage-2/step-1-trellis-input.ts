import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TrellisInputRequest,
  TrellisInputResponse,
  TrellisInputStepDefinition,
} from './interfaces/trellis-input.interface.js';
import type { SegmentPrompt } from '../shared/common/interfaces/index.js';
import { FigureMatter } from '../shared/common/figure-matter.js';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { SamSegmenter } from '../shared/common/sam-segmenter.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';

interface CutPaths {
  readonly art: string;
  readonly cutout: string;
  readonly trellisInput: string;
  readonly work: string;
}

export class TrellisInputGenerator {
  private static readonly stepId = 's2-step-1';

  private static runPython(step: TrellisInputStepDefinition, mode: string, args: readonly string[]): Record<string, unknown> {
    const script = join(WorkspacePaths.appRoot, step.parameters.python_script);
    const outcome = spawnSync('python3', [script, mode, ...args], { encoding: 'utf8' });
    if (outcome.status !== 0) {
      throw new Error(`TRELLIS input ${mode} failed: ${outcome.stderr}`);
    }
    return JSON.parse(outcome.stdout.trim()) as Record<string, unknown>;
  }

  private static async planeMask(step: TrellisInputStepDefinition, paths: CutPaths): Promise<readonly string[]> {
    const prompt = this.runPython(step, 'plane-prompt', ['--art', paths.art]) as unknown as SegmentPrompt;
    if (!prompt.positives.length) return [];
    const maskPath = join(paths.work, 'plane-masks.png');
    writeFileSync(maskPath, await SamSegmenter.allMasks(paths.art, prompt));
    return ['--plane-mask', maskPath];
  }

  private static async figureMasks(step: TrellisInputStepDefinition, paths: CutPaths, plane: readonly string[]): Promise<string> {
    const prompt = this.runPython(step, 'figure-prompt', ['--art', paths.art, ...plane]) as unknown as SegmentPrompt;
    const masksPath = join(paths.work, 'figure-masks.png');
    writeFileSync(masksPath, await SamSegmenter.allMasks(paths.art, prompt));
    return masksPath;
  }

  private static async cutFigure(step: TrellisInputStepDefinition, paths: CutPaths): Promise<Record<string, unknown>> {
    const plane = await this.planeMask(step, paths);
    const masks = await this.figureMasks(step, paths, plane);
    const colour = join(paths.work, 'colour.png');
    const trimap = join(paths.work, 'trimap.png');
    const prepared = this.runPython(step, 'prepare', [
      '--art', paths.art, '--figure-masks', masks, ...plane, '--out-cutout', paths.cutout,
      '--out-colour', colour, '--out-trimap', trimap, '--size', String(step.parameters.image_size),
    ]);
    const alpha = join(paths.work, 'alpha.png');
    writeFileSync(alpha, await FigureMatter.alpha(colour, trimap));
    const composed = this.runPython(step, 'compose', ['--colour', colour, '--alpha', alpha, '--out', paths.trellisInput]);
    return { ...prepared, ...composed };
  }

  public static async execute(request: TrellisInputRequest): Promise<TrellisInputResponse> {
    const { name } = request;
    const step = PipelineConfigLoader.getStep(this.stepId) as unknown as TrellisInputStepDefinition;
    const stageDir = join(WorkspacePaths.resourcePath(name), step.stage_dir);
    mkdirSync(stageDir, { recursive: true });

    const startMsg = step.messages.start.replace('{model}', name);
    console.log(`\n  \x1b[35m${startMsg}\x1b[0m`);
    ProgressHub.report(name, this.stepId, startMsg);

    const start = Date.now();
    const cutoutPath = join(stageDir, step.outputs.cutout_resource);
    const trellisInputPath = join(stageDir, step.outputs.trellis_input_resource);
    const work = mkdtempSync(join(tmpdir(), 'papikapi-trellis-input-'));
    let report: Record<string, unknown>;
    try {
      const art = join(WorkspacePaths.resourcePath(name), step.inputs.stage_dir, step.inputs.art_resource);
      report = await this.cutFigure(step, { art, cutout: cutoutPath, trellisInput: trellisInputPath, work });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }

    const duration = Math.round(((Date.now() - start) / 1000) * 100) / 100;
    const completedMsg = step.messages.completed.replace('{model}', name).replace('{duration}', String(duration));
    console.log(`  \x1b[32m${completedMsg}\x1b[0m`);
    ProgressHub.report(name, this.stepId, completedMsg);

    ManifestManager.writeStepResult(name, this.stepId, {
      status: step.manifest_contract.status,
      seconds: duration,
      costUsd: step.manifest_contract.costUsd,
      costNote: step.manifest_contract.costNote,
      data: report,
    });
    return { name, cutoutPath, trellisInputPath };
  }
}
