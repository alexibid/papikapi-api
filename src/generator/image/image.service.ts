import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

export interface CropOptions {
  columns: number;
  rows: number;
  pickIndex: number;
  quality?: number;
}

@Injectable()
export class ImageService {
  private readonly insetRatio = 0.025;
  private readonly defaultQuality = 95;

  public async cropCell(imageBuffer: Buffer, options: CropOptions): Promise<Buffer> {
    const total = options.columns * options.rows;
    if (options.pickIndex < 1 || options.pickIndex > total) {
      throw new Error(`Pick index ${options.pickIndex} out of bounds [1, ${total}]`);
    }

    const metadata = await sharp(imageBuffer).metadata();
    const imageWidth = metadata.width || 1536;
    const imageHeight = metadata.height || 1024;

    const cellWidth = Math.floor(imageWidth / options.columns);
    const cellHeight = Math.floor(imageHeight / options.rows);
    const column = (options.pickIndex - 1) % options.columns;
    const row = Math.floor((options.pickIndex - 1) / options.columns);

    const insetX = Math.round(cellWidth * this.insetRatio);
    const insetY = Math.round(cellHeight * this.insetRatio);

    const region = {
      left: column * cellWidth + insetX,
      top: row * cellHeight + insetY,
      width: cellWidth - 2 * insetX,
      height: cellHeight - 2 * insetY,
    };

    const quality = options.quality ?? this.defaultQuality;

    return sharp(imageBuffer)
      .extract(region)
      .jpeg({ quality })
      .toBuffer();
  }

  public dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
    const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      return {
        buffer: Buffer.from(dataUrl, 'base64'),
        mime: 'image/jpeg',
      };
    }
    return {
      mime: match[1] || 'image/jpeg',
      buffer: Buffer.from(match[2] || '', 'base64'),
    };
  }
}
