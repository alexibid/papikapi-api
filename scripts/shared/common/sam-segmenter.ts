import { AutoProcessor, LogLevel, RawImage, Sam2Model, env, type Tensor } from '@huggingface/transformers';
import sharp from 'sharp';
import type { LoadedSegmenter, SegmentPrompt, SegmenterOptions } from './interfaces/index.js';

env.allowLocalModels = false;
env.logLevel = LogLevel.ERROR;

export class SamSegmenter {
  private static readonly modelId = 'onnx-community/sam2.1-hiera-tiny-ONNX';
  private static readonly maskCount = 3;
  private static segmenterPromise: Promise<LoadedSegmenter> | null = null;

  public static async bestMask(imagePath: string, prompt: SegmentPrompt): Promise<Buffer> {
    const { masks, scores } = await this.segment(imagePath, prompt);
    const best = scores.indexOf(Math.max(...scores));
    const [height, width] = masks.dims.slice(-2);
    const pixels = this.maskPixels(masks, best).map((inside) => (inside ? 255 : 0));
    return sharp(Buffer.from(pixels), { raw: { width, height, channels: 1 } }).png().toBuffer();
  }

  public static async allMasks(imagePath: string, prompt: SegmentPrompt): Promise<Buffer> {
    const { masks } = await this.segment(imagePath, prompt);
    const [height, width] = masks.dims.slice(-2);
    const layers = Array.from({ length: this.maskCount }, (_, index) => this.maskPixels(masks, index));
    const interleaved = Buffer.alloc(height * width * this.maskCount);
    layers.forEach((layer, channel) => layer.forEach((inside, pixel) => {
      interleaved[pixel * this.maskCount + channel] = inside ? 255 : 0;
    }));
    return sharp(interleaved, { raw: { width, height, channels: this.maskCount } }).png().toBuffer();
  }

  private static async segment(imagePath: string, prompt: SegmentPrompt): Promise<{ masks: Tensor; scores: number[] }> {
    const image = (await RawImage.read(imagePath)).rgb();
    const { model, processor } = await this.segmenter();
    const inputs = await processor(image, this.optionsOf(prompt));
    const { pred_masks, iou_scores } = await model(inputs);
    const [masks] = await processor.post_process_masks(pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    return { masks, scores: Array.from(iou_scores.data as Float32Array) };
  }

  private static maskPixels(masks: Tensor, index: number): Uint8Array {
    const [height, width] = masks.dims.slice(-2);
    return (masks.data as Uint8Array).subarray(index * height * width, (index + 1) * height * width);
  }

  private static optionsOf(prompt: SegmentPrompt): SegmenterOptions {
    const points = [...prompt.positives, ...prompt.negatives].map(([x, y]) => [x, y]);
    const labels = [...prompt.positives.map(() => 1), ...prompt.negatives.map(() => 0)];
    const options = { input_points: [[points]], input_labels: [[labels]] };
    return prompt.box ? { ...options, input_boxes: [[[...prompt.box]]] } : options;
  }

  private static segmenter(): Promise<LoadedSegmenter> {
    this.segmenterPromise ??= (async () => {
      const model = (await Sam2Model.from_pretrained(this.modelId, { dtype: 'fp32' })) as unknown as LoadedSegmenter['model'];
      const processor = (await AutoProcessor.from_pretrained(this.modelId)) as unknown as LoadedSegmenter['processor'];
      return { model, processor };
    })();
    return this.segmenterPromise;
  }
}
