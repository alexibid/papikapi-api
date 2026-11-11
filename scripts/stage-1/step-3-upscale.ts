import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { UpscaleRequest, UpscaleResponse, UpscaleStepDefinition } from './stage-1.interface.js';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';

export class ArtUpscaler {
  private static readonly stepId = 's1-step-3';

  private static enlarge(step: UpscaleStepDefinition, artPath: string, upscaledPath: string): Record<string, unknown> {
    const { python_script, super_resolution: sr } = step.parameters;
    const outcome = spawnSync('python3', [
      join(WorkspacePaths.appRoot, python_script), '--art', artPath, '--out', upscaledPath,
      '--sr-binary', sr.binary, '--sr-model', sr.model, '--sr-scale', String(sr.scale),
    ], { encoding: 'utf8' });
    if (outcome.status !== 0) {
      throw new Error(`Upscale failed: ${outcome.stderr}`);
    }
    return JSON.parse(outcome.stdout.trim()) as Record<string, unknown>;
  }

  public static async execute(request: UpscaleRequest): Promise<UpscaleResponse> {
    const { name } = request;
    const step = PipelineConfigLoader.getStep(this.stepId) as unknown as UpscaleStepDefinition;
    const resourceDir = WorkspacePaths.resourcePath(name);
    const artPath = join(resourceDir, step.inputs.stage_dir, step.inputs.art_resource);
    const upscaledPath = join(resourceDir, step.outputs.stage_dir, step.outputs.upscaled_resource);

    const startMsg = step.messages.start.replace('{model}', name);
    console.log(`\n  \x1b[35m${startMsg}\x1b[0m`);
    ProgressHub.report(name, this.stepId, startMsg);

    const start = Date.now();
    const report = this.enlarge(step, artPath, upscaledPath);
    if (report.method !== step.parameters.super_resolution.model) {
      console.warn(`  [${this.stepId}] Real-ESRGAN is not installed here: ${String(report.method)} was used instead`);
    }
    const duration = Math.round(((Date.now() - start) / 1000) * 100) / 100;
    const completedMsg = step.messages.completed
      .replace('{model}', name)
      .replace('{method}', String(report.method))
      .replace('{duration}', String(duration));
    console.log(`  \x1b[32m${completedMsg}\x1b[0m`);
    ProgressHub.report(name, this.stepId, completedMsg);

    ManifestManager.writeStepResult(name, this.stepId, {
      status: step.manifest_contract.status,
      seconds: duration,
      costUsd: step.manifest_contract.costUsd,
      costNote: step.manifest_contract.costNote,
      data: report,
    });
    return { name, upscaledPath };
  }
}
