import type { PlinthParameters } from '../../shared/common/glb/glb.interface.js';

export interface TrellisStepInputs {
  readonly stage_dir: string;
  readonly trellis_input_resource: string;
  readonly allowed_extensions: readonly string[];
}

export interface TrellisStepOutputs {
  readonly stage_dir: string;
  readonly model_resource: string;
  readonly preview_resource: string;
  readonly model_public: string;
  readonly model_pick_resource_pattern: string;
  readonly public_url_pattern: string;
  readonly manifest: string;
}

export interface TrellisServerlessConfig {
  readonly env_endpoint_key: string;
  readonly container_image: string;
  readonly client_timeout_seconds: number;
  readonly api_url_pattern: string;
  readonly async_url_pattern: string;
  readonly status_url_pattern: string;
}

export interface TrellisStepParameters {
  readonly seed: number | 'random';
  readonly resolution: '512' | '1024' | '1536';
  readonly decimation_target: number;
  readonly texture_size: number;
  readonly plinth: PlinthParameters;
  readonly quality_gate: TrellisQualityGate;
}

export interface TrellisQualityGate {
  readonly python_script: string;
  readonly max_attempts: number;
  readonly overlap_min: number;
  readonly parts_max: number;
  readonly extra_part_penalty: number;
  readonly parts_grid: number;
  readonly part_min_share: number;
  readonly camera_grid_px: number;
  readonly camera_yaw_range_deg: readonly number[];
  readonly camera_pitch_range_deg: readonly number[];
  readonly camera_points_max: number;
}

export interface TrellisGateVerdict {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly overlap: number;
  readonly parts: number;
  readonly score: number;
}

export interface TrellisStepRunner {
  readonly platform: string;
  readonly device: string;
  readonly rate: string;
}

export interface TrellisStepMessages {
  readonly start: string;
  readonly progress: string;
  readonly completed: string;
  readonly cache_hit: string;
}

export interface TrellisManifestContract {
  readonly status: string;
  readonly costNote: string;
  readonly cache_cost_note: string;
  readonly data: {
    readonly format: string;
    readonly device: string;
  };
}

export interface TrellisStepDependsOn {
  readonly step_id: string;
  readonly stage_dir: string;
}

export interface TrellisStepDefinition {
  readonly id: string;
  readonly stage_dir: string;
  readonly serverless: TrellisServerlessConfig;
  readonly depends_on: TrellisStepDependsOn;
  readonly inputs: TrellisStepInputs;
  readonly outputs: TrellisStepOutputs;
  readonly parameters: TrellisStepParameters;
  readonly runner: TrellisStepRunner;
  readonly messages: TrellisStepMessages;
  readonly manifest_contract: TrellisManifestContract;
}

export interface TrellisGenerateResponse {
  readonly name: string;
  readonly outputPath: string;
  readonly publicPath: string;
  readonly seconds: number;
  readonly costUsd: number;
  readonly cached?: boolean;
}

export type TrellisStreamPart = 'preview' | 'glb';

export interface TrellisStreamChunk {
  readonly part: TrellisStreamPart;
  readonly chunk_index: number;
  readonly chunk_count: number;
  readonly data: string;
  readonly file_size: number;
  readonly face_count?: number;
  readonly seed?: number;
  readonly error?: string;
}

export interface TrellisRequest {
  readonly step: TrellisStepDefinition;
  readonly modelName: string;
  readonly endpointId: string;
  readonly usdPerSec: number;
  readonly inputPath: string;
}

export interface TrellisAttempt {
  readonly glb: Buffer;
  readonly preview: Buffer;
  readonly seconds: number;
  readonly costUsd: number;
  readonly faceCount: number;
  readonly settings: {
    readonly seed: number;
    readonly resolution: string;
    readonly decimation_target: number;
    readonly texture_size: number;
  };
}

export interface ChosenAttempt {
  readonly attempt: TrellisAttempt;
  readonly verdict: TrellisGateVerdict;
  readonly history: readonly (TrellisGateVerdict & { readonly seed: number })[];
  readonly seconds: number;
  readonly costUsd: number;
}
