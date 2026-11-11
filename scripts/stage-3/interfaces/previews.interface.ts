import type { BlenderConfig } from '../../shared/common/interfaces/index.js';

export interface PreviewsBlenderConfig extends BlenderConfig {
  readonly script: string;
}

export interface PreviewsOutputs {
  readonly stage_dir: string;
  readonly three_quarter_public: string;
  readonly three_quarter_wire_public: string;
  readonly manifest: string;
}

export interface PreviewsStepDefinition {
  readonly id: string;
  readonly stage_dir: string;
  readonly blender: PreviewsBlenderConfig;
  readonly inputs: {
    readonly stage_dir: string;
    readonly model_resource: string;
    readonly trellis_stage_dir: string;
    readonly trellis_resource: string;
    readonly art_stage_dir: string;
    readonly art_resource: string;
  };
  readonly outputs: PreviewsOutputs;
  readonly parameters: Readonly<Record<string, number | readonly number[]>>;
  readonly messages: {
    readonly start: string;
    readonly completed: string;
  };
  readonly manifest_contract: {
    readonly status: string;
    readonly costNote: string;
  };
}

export interface CameraStatistics {
  readonly type: string;
  readonly pitchDeg: number;
  readonly yawDeg: number;
  readonly heading: number;
  readonly centre: readonly [number, number, number];
  readonly size: number;
  readonly orthoScale: number;
  readonly location: readonly [number, number, number];
  readonly direction: readonly [number, number, number];
}

export interface LightingStatistics {
  readonly studioLight: string;
  readonly viewTransform: string;
  readonly exposureUsed: number;
  readonly fluxLuminance: number;
  readonly previewLuminance: number;
  readonly luminanceMatchRatio: number;
}

export interface PreviewsStatistics {
  readonly threeQuarterYawDeg: number;
  readonly faces: number;
  readonly camera?: CameraStatistics;
  readonly lighting?: LightingStatistics;
}

export interface PreviewsResponse {
  readonly name: string;
  readonly previewPaths: readonly string[];
  readonly seconds: number;
}
