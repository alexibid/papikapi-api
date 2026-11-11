import type { BlenderConfig } from '../../shared/common/interfaces/index.js';
import type { ArtInput } from './eyes.interface.js';

export interface AtlasBlenderConfig extends BlenderConfig {
  readonly bake_script: string;
}

export interface AtlasOutputs {
  readonly stage_dir: string;
  readonly atlas_resource: string;
  readonly uv_resource: string;
  readonly manifest: string;
}

export interface AtlasStepDefinition {
  readonly id: string;
  readonly stage_dir: string;
  readonly blender: AtlasBlenderConfig;
  readonly inputs: ArtInput & {
    readonly stage_dir: string;
    readonly model_resource: string;
    readonly points_resource: string;
    readonly trellis_atlas_resource: string;
    readonly detailed_stage_dir: string;
    readonly detailed_model_resource: string;
  };
  readonly outputs: AtlasOutputs;
  readonly bake: Readonly<Record<string, number | string>>;
  readonly colour_calibration: ColourCalibrationSettings;
  readonly messages: {
    readonly start: string;
    readonly completed: string;
  };
  readonly manifest_contract: {
    readonly status: string;
    readonly costNote: string;
  };
}

export interface AtlasResponse {
  readonly name: string;
  readonly atlasPath: string;
  readonly uvPath: string;
  readonly seconds: number;
}

export interface ColourCalibrationSettings {
  readonly sample_step_px: number;
  readonly edge_inset_px: number;
  readonly flat_colour_distance: number;
  readonly dark_luminance_min: number;
  readonly channel_gain_range: readonly number[];
  readonly exposure_quantile: number;
  readonly exposure_range: readonly number[];
  readonly neutral_saturation: number;
  readonly pairs_min: number;
}

export interface AtlasStatistics {
  readonly resolution: number;
  readonly faces: number;
  readonly eyeTexels: number;
  readonly colourPairs?: number;
  readonly colourResidual?: number;
}
