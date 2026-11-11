import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BlenderRunner } from '../shared/common/blender-runner.js';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import type {
  TrellisAtlasResponse,
  TrellisAtlasStatistics,
  TrellisAtlasStepDefinition,
} from './interfaces/trellis-atlas.interface.js';

export class TrellisAtlasGenerator {
  private static readonly stepId = 's3-step-2';

  private static trellisModel(modelName: string, step: TrellisAtlasStepDefinition): string {
    const model = join(WorkspacePaths.resourcePath(modelName), step.inputs.stage_dir, step.inputs.model_resource);
    if (!existsSync(model)) {
      throw new Error(`TRELLIS model not found for '${modelName}': ${model}`);
    }
    return model;
  }

  public static async execute(modelName: string): Promise<TrellisAtlasResponse> {
    const step = PipelineConfigLoader.getStep(this.stepId) as unknown as TrellisAtlasStepDefinition;
    const stageDir = join(WorkspacePaths.resourcePath(modelName), step.outputs.stage_dir);
    mkdirSync(stageDir, { recursive: true });
    const modelPath = this.trellisModel(modelName, step);
    const atlasPath = join(stageDir, step.outputs.atlas_resource);

    const startMsg = step.messages.start.replace('{model}', modelName);
    console.log(`\n  \x1b[35m${startMsg}\x1b[0m`);
    ProgressHub.report(modelName, this.stepId, startMsg);

    const start = Date.now();
    const statistics = BlenderRunner.run<TrellisAtlasStatistics>(step.blender, step.blender.script, {
      model_glb: modelPath,
      output_image: atlasPath,
    });
    const duration = Math.round(((Date.now() - start) / 1000) * 100) / 100;

    const completedMsg = step.messages.completed.replace('{model}', modelName).replace('{duration}', String(duration));
    console.log(`  \x1b[32m${completedMsg}\x1b[0m\n`);
    ProgressHub.report(modelName, this.stepId, completedMsg);

    ManifestManager.writeStepResult(modelName, this.stepId, {
      status: step.manifest_contract.status,
      seconds: duration,
      costUsd: 0.0,
      costNote: step.manifest_contract.costNote,
      metrics: { width: statistics.width, height: statistics.height },
      data: { source: modelPath },
    });

    return { name: modelName, atlasPath, seconds: duration };
  }
}
