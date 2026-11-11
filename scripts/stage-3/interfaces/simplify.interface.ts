import type { BlenderConfig } from '../../shared/common/interfaces/index.js';
import type { ArtInput, EyeSettings } from './eyes.interface.js';

export interface SimplifyBlenderConfig extends BlenderConfig {
  readonly script: string;
}

export interface SimplifyOutputs {
  readonly stage_dir: string;
  readonly model_resource: string;
  readonly points_resource: string;
  readonly manifest: string;
}

export interface SimplifyStepDefinition {
  readonly id: string;
  readonly stage_dir: string;
  readonly blender: SimplifyBlenderConfig;
  readonly inputs: ArtInput & {
    readonly stage_dir: string;
    readonly model_resource: string;
    readonly model_pick_resource_pattern?: string;
  };
  readonly outputs: SimplifyOutputs;
  readonly parameters: Readonly<Record<string, number | string>>;
  readonly eyes: EyeSettings;
  readonly messages: {
    readonly start: string;
    readonly completed: string;
  };
  readonly manifest_contract: {
    readonly status: string;
    readonly costNote: string;
  };
}

export interface ReductionAttempt {
  readonly targetFaces: number;
  readonly meshFaces: number;
  readonly volumeChangePercent: number;
  readonly featureLossMm: number;
  readonly failures: readonly string[];
}

export interface SimplifyStatistics {
  readonly lengthMm: number;
  readonly faces: number;
  readonly points: number;
  readonly meshFaces: number;
  readonly quads: number;
  readonly openEdges: number;
  readonly nonManifoldEdges: number;
  readonly airtight: boolean;
  readonly volumeChangePercent: number;
  readonly dimensionChangePercent: number;
  readonly maxDeviationMm: number;
  readonly featureLossMm: number;
  readonly closingDeviationMm: number;
  readonly innerWallShare: number;
  readonly mode: string;
  readonly attempts: readonly ReductionAttempt[];
  readonly eyes: number;
  readonly eyeVerticesFlattened?: number;
  readonly eyesSkipped?: string;
}

export interface SimplifyResponse {
  readonly name: string;
  readonly modelPath: string;
  readonly pointsPath: string;
  readonly seconds: number;
}
