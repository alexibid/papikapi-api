import { AutoProcessor, RawImage, VitMatteForImageMatting } from '@huggingface/transformers';
import sharp from 'sharp';
import type { LoadedMatter } from './interfaces/index.js';

export class FigureMatter {
  private static readonly modelId = 'Xenova/vitmatte-small-composition-1k';
  private static matterPromise: Promise<LoadedMatter> | null = null;

  public static async alpha(colourPath: string, trimapPath: string): Promise<Buffer> {
    const image = (await RawImage.read(colourPath)).rgb();
    const trimap = (await RawImage.read(trimapPath)).grayscale();
    const { model, processor } = await this.matter();
    const { alphas } = await model(await processor(image, trimap));
    const [height, width] = alphas.dims.slice(-2);
    const values = Uint8Array.from(alphas.data as Float32Array, (value) => Math.round(Math.min(Math.max(value, 0), 1) * 255));
    return sharp(Buffer.from(values), { raw: { width, height, channels: 1 } })
      .extract({ left: 0, top: 0, width: image.width, height: image.height })
      .png()
      .toBuffer();
  }

  private static matter(): Promise<LoadedMatter> {
    this.matterPromise ??= (async () => {
      const model = (await VitMatteForImageMatting.from_pretrained(this.modelId, { dtype: 'fp32' })) as unknown as LoadedMatter['model'];
      const processor = (await AutoProcessor.from_pretrained(this.modelId)) as unknown as LoadedMatter['processor'];
      return { model, processor };
    })();
    return this.matterPromise;
  }
}
