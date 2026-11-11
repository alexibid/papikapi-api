import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BlenderRunner } from '../shared/common/blender-runner.js';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import type {
  PreviewsOutputs,
  PreviewsResponse,
  PreviewsStatistics,
  PreviewsStepDefinition,
} from './interfaces/previews.interface.js';
import type { SimplifyStepDefinition } from './interfaces/simplify.interface.js';

export class PreviewsGenerator {
  private static readonly stepId = 's3-step-6';

  private static requireFile(path: string): string {
    if (!existsSync(path)) {
      throw new Error(`Preview input not found: ${path}`);
    }
    return path;
  }

  private static publicPaths(publicDir: string, outputs: PreviewsOutputs): Record<string, string> {
    return {
      three_quarter: join(publicDir, outputs.three_quarter_public),
      three_quarter_wire: join(publicDir, outputs.three_quarter_wire_public),
    };
  }

  private static artView(step: PreviewsStepDefinition, resourceDir: string, artPath: string): object {
    const simplify = PipelineConfigLoader.getStep('s3-step-1') as unknown as SimplifyStepDefinition;
    const trellisGlb = this.requireFile(join(resourceDir, step.inputs.trellis_stage_dir, step.inputs.trellis_resource));
    return { trellis_glb: trellisGlb, art_cutout: artPath, camera: simplify.eyes };
  }

  public static async execute(modelName: string): Promise<PreviewsResponse> {
    const step = PipelineConfigLoader.getStep(this.stepId) as unknown as PreviewsStepDefinition;
    const resourceDir = WorkspacePaths.resourcePath(modelName);
    const modelPath = this.requireFile(join(resourceDir, step.inputs.stage_dir, step.inputs.model_resource));
    const artPath = this.requireFile(join(resourceDir, step.inputs.art_stage_dir, step.inputs.art_resource));
    const publicDir = WorkspacePaths.modelPath(modelName);
    mkdirSync(publicDir, { recursive: true });
    const outputs = this.publicPaths(publicDir, step.outputs);

    const startMsg = step.messages.start.replace('{model}', modelName);
    console.log(`\n  \x1b[35m${startMsg}\x1b[0m`);
    ProgressHub.report(modelName, this.stepId, startMsg);

    const start = Date.now();
    const statistics = BlenderRunner.run<PreviewsStatistics>(step.blender, step.blender.script, {
      model_glb: modelPath,
      art_view: this.artView(step, resourceDir, artPath),
      outputs,
      ...step.parameters,
    });
    const duration = Math.round(((Date.now() - start) / 1000) * 100) / 100;

    const completedMsg = step.messages.completed
      .replace('{model}', modelName)
      .replace('{duration}', String(duration));
    console.log(`  \x1b[32m${completedMsg}\x1b[0m\n`);
    ProgressHub.report(modelName, this.stepId, completedMsg);

    ManifestManager.writeStepResult(modelName, this.stepId, {
      status: step.manifest_contract.status,
      seconds: duration,
      costUsd: 0.0,
      costNote: step.manifest_contract.costNote,
      metrics: {
        threeQuarterYawDeg: statistics.threeQuarterYawDeg,
        faces: statistics.faces,
        ...(statistics.lighting ? {
          fluxLuminance: statistics.lighting.fluxLuminance,
          previewLuminance: statistics.lighting.previewLuminance,
          luminanceMatchRatio: statistics.lighting.luminanceMatchRatio,
          exposureUsed: statistics.lighting.exposureUsed,
        } : {}),
      },
      data: {
        source: modelPath,
        previews: outputs,
        parameters: step.parameters,
        ...(statistics.camera ? { camera: statistics.camera } : {}),
        ...(statistics.lighting ? { lighting: statistics.lighting } : {}),
      },
    });

    return { name: modelName, previewPaths: Object.values(outputs), seconds: duration };
  }
}

if (process.argv[1]?.endsWith('step-6-previews.ts')) {
  const model = process.argv[2] ?? '2ia2hryn';
  PreviewsGenerator.execute(model).catch(console.error);
}
