import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BlenderRunner } from '../shared/common/blender-runner.js';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import type { AtlasResponse, AtlasStatistics, AtlasStepDefinition } from './interfaces/atlas.interface.js';
import type { SimplifyStepDefinition } from './interfaces/simplify.interface.js';
import { ArtEyeFinder } from './art-eye-finder.js';

interface GroundedDocument {
  readonly groundOffset: readonly number[];
}

function isGroundedDocument(value: unknown): value is GroundedDocument {
  if (typeof value !== 'object' || value === null || !('groundOffset' in value)) return false;
  const offset = value.groundOffset;
  return Array.isArray(offset) && offset.length === 3 && offset.every((axis) => typeof axis === 'number');
}

export class AtlasGenerator {
  private static readonly stepId = 's3-step-3';

  private static groundOffset(pointsPath: string): readonly number[] {
    const document: unknown = JSON.parse(readFileSync(pointsPath, 'utf8'));
    if (!isGroundedDocument(document)) {
      throw new Error(`No ground offset in ${pointsPath}`);
    }
    return document.groundOffset;
  }

  private static eyeSettings(): SimplifyStepDefinition['eyes'] {
    const simplify = PipelineConfigLoader.getStep('s3-step-1') as unknown as SimplifyStepDefinition;
    return simplify.eyes;
  }

  /** Every figure is brought to the art's colours: TRELLIS bakes its base colour with a tint of its own. */
  private static colourCalibration(step: AtlasStepDefinition): object {
    return { colour_calibration: step.colour_calibration };
  }

  private static resolveFile(candidates: readonly string[], description: string): string {
    const found = candidates.find((c) => existsSync(c));
    if (!found) {
      throw new Error(`${description} not found. Tried: ${candidates.join(', ')}`);
    }
    return found;
  }

  public static async execute(modelName: string): Promise<AtlasResponse> {
    const step = PipelineConfigLoader.getStep(this.stepId) as unknown as AtlasStepDefinition;
    const stageDir = join(WorkspacePaths.resourcePath(modelName), step.stage_dir);
    mkdirSync(stageDir, { recursive: true });

    const resourceDir = WorkspacePaths.resourcePath(modelName);
    const simpleCandidates = [
      join(stageDir, step.inputs.model_resource),
      join(stageDir, 'step-1-simplify.glb'),
    ];
    const simplePath = this.resolveFile(simpleCandidates, 'Simplified mesh');

    const pointsCandidates = [
      join(stageDir, step.inputs.points_resource),
      join(stageDir, 'step-1-simplify.json'),
    ];
    const pointsPath = this.resolveFile(pointsCandidates, 'Points document');

    const detailedCandidates = [
      join(resourceDir, step.inputs.detailed_stage_dir, step.inputs.detailed_model_resource),
    ];
    const detailedPath = this.resolveFile(detailedCandidates, 'Detailed model');

    const atlasPath = join(stageDir, step.outputs.atlas_resource);
    const uvPath = join(stageDir, step.outputs.uv_resource);

    const startMsg = step.messages.start.replace('{model}', modelName);
    console.log(`\n  \x1b[35m${startMsg}\x1b[0m`);
    ProgressHub.report(modelName, this.stepId, startMsg);

    const start = Date.now();

    const groundOffset = this.groundOffset(pointsPath);
    const artCutout = this.resolveFile([join(resourceDir, step.inputs.art_stage_dir, step.inputs.art_resource)], 'Art cutout');
    const trellisAtlas = this.resolveFile([join(stageDir, step.inputs.trellis_atlas_resource)], 'TRELLIS atlas');
    const eyes = this.eyeSettings();
    const statistics = ArtEyeFinder.withArtEye(artCutout, eyes, (artEye) =>
      BlenderRunner.run<AtlasStatistics>(step.blender, step.blender.bake_script, {
        detailed_glb: detailedPath,
        trellis_atlas: trellisAtlas,
        simple_glb: simplePath,
        ground_offset: groundOffset,
        output_image: atlasPath,
        output_uv_json: uvPath,
        ...artEye,
        eyes,
        ...step.bake,
        ...this.colourCalibration(step),
      }),
    );

    const duration = Math.round(((Date.now() - start) / 1000) * 100) / 100;

    const completedMsg = step.messages.completed
      .replace('{model}', modelName)
      .replace('{faces}', String(statistics.faces))
      .replace('{duration}', String(duration));
    console.log(`  \x1b[32m${completedMsg}\x1b[0m\n`);
    ProgressHub.report(modelName, this.stepId, completedMsg);

    ManifestManager.writeStepResult(modelName, this.stepId, {
      status: step.manifest_contract.status,
      seconds: duration,
      costUsd: 0.0,
      costNote: step.manifest_contract.costNote,
      metrics: {
        resolution: statistics.resolution,
        faces: statistics.faces,
        eyeTexels: statistics.eyeTexels,
        ...(statistics.colourPairs === undefined ? {} : {
          colourPairs: statistics.colourPairs,
          colourResidual: statistics.colourResidual,
        }),
      },
      data: {
        source: detailedPath,
        bake: step.bake,
      },
    });

    return { name: modelName, atlasPath, uvPath, seconds: duration };
  }
}
