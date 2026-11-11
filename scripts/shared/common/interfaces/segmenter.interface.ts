import type { RawImage, Tensor } from '@huggingface/transformers';

export type ImagePoint = readonly [number, number];
export type ImageBox = readonly [number, number, number, number];

export interface SegmentPrompt {
  readonly positives: readonly ImagePoint[];
  readonly negatives: readonly ImagePoint[];
  readonly box?: ImageBox;
}

export interface SegmenterInputs {
  readonly original_sizes: unknown;
  readonly reshaped_input_sizes: unknown;
}

export interface SegmenterOptions {
  readonly input_points: number[][][][];
  readonly input_labels: number[][][];
  readonly input_boxes?: number[][][];
}

export interface LoadedSegmenter {
  readonly model: (inputs: SegmenterInputs) => Promise<{ readonly pred_masks: Tensor; readonly iou_scores: Tensor }>;
  readonly processor: {
    (image: RawImage, options: SegmenterOptions): Promise<SegmenterInputs>;
    post_process_masks(masks: Tensor, originalSizes: unknown, reshapedSizes: unknown): Promise<Tensor[]>;
  };
}

export interface LoadedMatter {
  readonly model: (inputs: unknown) => Promise<{ readonly alphas: Tensor }>;
  readonly processor: (image: RawImage, trimap: RawImage) => Promise<unknown>;
}
