import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { WorkspacePaths } from '../common/workspace-paths.js';

export interface FigureImages {
  readonly art: string | null;
  readonly trellis: string | null;
  readonly final: string | null;
  readonly eyes: string | null;
}

const THUMBNAIL_PX = 360;
const PAPER = { r: 236, g: 235, b: 231 };
const TRELLIS_GROUND = { r: 20, g: 20, b: 22 };

/**
 * The three views of a figure as small WebP data URIs: the FLUX art, the TRELLIS render (the left, shaded half of
 * its preview) and the final paper figure, so the PDF carries its own images.
 */
export class ReportImages {
  public static async of(id: string): Promise<FigureImages> {
    const publicDir = join(WorkspacePaths.publicModelsDir, id);
    const [art, trellis, final, eyes] = await Promise.all([
      this.thumbnail(join(publicDir, 'art.jpeg'), PAPER),
      this.trellisRender(join(WorkspacePaths.resourcePath(id), 'stage-2', 'step-2-preview.webp')),
      this.thumbnail(join(publicDir, 'preview-three-quarter.webp'), PAPER),
      this.thumbnail(join(publicDir, 'eye-detail.webp'), PAPER),
    ]);
    return { art, trellis, final, eyes };
  }

  private static async thumbnail(path: string, ground: typeof PAPER): Promise<string | null> {
    if (!existsSync(path)) return null;
    return this.dataUri(sharp(path).flatten({ background: ground }));
  }

  private static async trellisRender(path: string): Promise<string | null> {
    if (!existsSync(path)) return null;
    const { width = 0, height = 0 } = await sharp(path).metadata();
    const half = sharp(path).extract({ left: 0, top: 0, width: Math.floor(width / 2), height });
    return this.dataUri(half.flatten({ background: TRELLIS_GROUND }));
  }

  private static async dataUri(image: sharp.Sharp): Promise<string> {
    const bytes = await image.resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: 'inside' }).webp({ quality: 80 }).toBuffer();
    return `data:image/webp;base64,${bytes.toString('base64')}`;
  }
}
