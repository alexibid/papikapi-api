import { describe, expect, it } from 'vitest';
import { PipelineConfigLoader } from './pipeline-config.js';

interface QualityParameters {
  readonly resolution?: number | string;
  readonly decimation_target?: number;
  readonly texture_size?: number;
  readonly image_size?: number;
}

function parametersOf(stepId: string): QualityParameters {
  return (PipelineConfigLoader.getStep(stepId) as unknown as { readonly parameters: QualityParameters }).parameters;
}

describe('active pipeline keeps the detail quality floor', () => {
  it('asks TRELLIS for the official Space settings: resolution 1024, 500000 faces, 2048 texture', () => {
    const trellis = parametersOf('s2-step-2');
    expect(Number(trellis.resolution)).toBeGreaterThanOrEqual(1024);
    expect(trellis.decimation_target).toBeGreaterThanOrEqual(500000);
    expect(trellis.texture_size).toBeGreaterThanOrEqual(2048);
  });

  it('hands TRELLIS an input of at least 1024 pixels', () => {
    expect(parametersOf('s2-step-1').image_size).toBeGreaterThanOrEqual(1024);
  });

  it('keeps stage 2 to the TRELLIS input and the untouched TRELLIS result', () => {
    const stage2 = PipelineConfigLoader.load().pipeline_stages[1].steps.map((step) => step.id);
    expect(stage2).toEqual(['s2-step-1', 's2-step-2']);
  });

  it('builds stage 3 from the untouched TRELLIS result', () => {
    const trellis = PipelineConfigLoader.getStep('s2-step-2') as unknown as { readonly outputs: { readonly model_resource: string } };
    const simplify = PipelineConfigLoader.getStep('s3-step-1') as unknown as { readonly inputs: { readonly model_resource: string } };
    const atlas = PipelineConfigLoader.getStep('s3-step-3') as unknown as { readonly inputs: { readonly detailed_model_resource: string } };
    expect(simplify.inputs.model_resource).toBe(trellis.outputs.model_resource);
    expect(atlas.inputs.detailed_model_resource).toBe(trellis.outputs.model_resource);
  });

  it('keeps the upscaled FLUX art as its own step and feeds it to the TRELLIS input', () => {
    const upscale = PipelineConfigLoader.getStep('s1-step-3') as unknown as { readonly outputs: { readonly upscaled_resource: string } };
    const trellisInput = PipelineConfigLoader.getStep('s2-step-1') as unknown as { readonly inputs: { readonly art_resource: string } };
    expect(upscale.outputs.upscaled_resource).toBe('step-3-upscaled.webp');
    expect(trellisInput.inputs.art_resource).toBe(upscale.outputs.upscaled_resource);
  });
});
