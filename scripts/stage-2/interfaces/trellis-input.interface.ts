export interface TrellisInputStepDefinition {
  readonly id: string;
  readonly stage_dir: string;
  readonly inputs: { readonly stage_dir: string; readonly art_resource: string };
  readonly outputs: {
    readonly stage_dir: string;
    readonly cutout_resource: string;
    readonly trellis_input_resource: string;
    readonly manifest: string;
  };
  readonly parameters: { readonly python_script: string; readonly image_size: number };
  readonly manifest_contract: { readonly status: string; readonly costUsd: number; readonly costNote: string };
  readonly messages: { readonly start: string; readonly completed: string };
}

export interface TrellisInputRequest {
  readonly name: string;
}

export interface TrellisInputResponse {
  readonly name: string;
  readonly cutoutPath: string;
  readonly trellisInputPath: string;
}
