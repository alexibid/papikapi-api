import type { BlenderConfig } from '../../shared/common/interfaces/index.js';

export interface TrellisAtlasStepDefinition {
  readonly id: string;
  readonly stage_dir: string;
  readonly blender: BlenderConfig & { readonly script: string };
  readonly inputs: {
    readonly stage_dir: string;
    readonly model_resource: string;
  };
  readonly outputs: {
    readonly stage_dir: string;
    readonly atlas_resource: string;
    readonly manifest: string;
  };
  readonly messages: {
    readonly start: string;
    readonly completed: string;
  };
  readonly manifest_contract: {
    readonly status: string;
    readonly costNote: string;
  };
}

export interface TrellisAtlasStatistics {
  readonly width: number;
  readonly height: number;
}

export interface TrellisAtlasResponse {
  readonly name: string;
  readonly atlasPath: string;
  readonly seconds: number;
}
