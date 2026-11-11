import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { WorkspacePaths } from '../../common/workspace-paths.js';
import { LoraDatasetBuilder } from './lora-dataset-builder.js';

interface ReferenceItem {
  readonly group: string;
  readonly body: string;
  readonly name: string;
  readonly file: string;
  readonly caption: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

type Rgb = readonly [number, number, number];

const PALETTE: Readonly<Record<string, string>> = {
  black: '#202020',
  blue: '#2E5BD8',
  red: '#D33A2C',
  green: '#2E9E4F',
  orange: '#F08A24',
  purple: '#7B4FC2',
  yellow: '#F2C230',
};

const ASSIGNMENTS: Readonly<Record<string, string>> = {
  'fire-truck': 'yellow',
  'police-car': 'red',
  tractor: 'red',
  submarine: 'blue',
  plane: 'black',
  train: 'green',
  't-rex': 'red',
  triceratops: 'black',
  brachiosaurus: 'red',
  stegosaurus: 'black',
  ankylosaurus: 'purple',
  velociraptor: 'blue',
  'orange-tabby': 'black',
  'gray-kitten': 'yellow',
  calico: 'black',
  'black-tuxedo': 'orange',
  siamese: 'orange',
  'white-kitten': 'yellow',
  lion: 'black',
  elephant: 'orange',
  giraffe: 'purple',
  zebra: 'orange',
  hippo: 'orange',
  cheetah: 'purple',
  squirrel: 'blue',
  fawn: 'purple',
  fox: 'green',
  bear: 'green',
  owl: 'purple',
  raccoon: 'yellow',
  dalmatian: 'orange',
  'german-shepherd': 'purple',
  pug: 'red',
  'blue-eyed-pug': 'red',
  'golden-puppy': 'purple',
  rottweiler: 'green',
  steve: 'yellow',
  alex: 'green',
  creeper: 'red',
  zombie: 'yellow',
  cow: 'yellow',
  pig: 'yellow',
  mario: 'green',
  sonic: 'black',
  'donkey-kong': 'blue',
  pikachu: 'blue',
  yoshi: 'blue',
  kirby: 'green',
  dolphin: 'red',
  'sea-turtle': 'purple',
  'hammerhead-shark': 'orange',
  octopus: 'green',
  clownfish: 'blue',
  seahorse: 'blue',
};

const SUPPORTED = new Set(['submarine', 'plane', 'dolphin', 'sea-turtle', 'hammerhead-shark']);

function fromHex(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function borderColour(width: number, height: number, pixel: (index: number) => Rgb): Rgb {
  const edge: Rgb[] = [];
  for (let col = 0; col < width; col++) edge.push(pixel(col), pixel((height - 1) * width + col));
  for (let row = 0; row < height; row++) edge.push(pixel(row * width), pixel(row * width + width - 1));
  const median = (channel: number): number =>
    edge.map((rgb) => rgb[channel]).sort((a, b) => a - b)[edge.length >> 1];
  return [median(0), median(1), median(2)];
}

function insidePoly(x: number, y: number, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToPoly(x: number, y: number, poly: readonly Point[]): number {
  let minDist = 999;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p1 = poly[j];
    const p2 = poly[i];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const l2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / l2));
    const px = p1.x + t * dx;
    const py = p1.y + t * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export class RenderReferencePlanes {
  private static readonly root = join(WorkspacePaths.appRoot, 'scripts/shared/training/references');
  private static readonly indexFile = join(RenderReferencePlanes.root, 'index.json');
  private static readonly captionsFile = join(WorkspacePaths.appRoot, 'scripts/shared/training/lora/captions.json');
  private static readonly metadataFile = join(RenderReferencePlanes.root, 'metadata.jsonl');

  public static async run(): Promise<void> {
    const items = JSON.parse(readFileSync(this.indexFile, 'utf8')) as ReferenceItem[];
    const db = new Database(join(WorkspacePaths.resourcesDir, 'papikapi.db'), { readonly: true });
    const rows = db.prepare('SELECT id, subject FROM models').all() as { id: string; subject: string }[];
    const subjectToId = new Map(rows.map((row) => [row.subject, row.id]));

    const captionsManifest = JSON.parse(readFileSync(this.captionsFile, 'utf8')) as {
      trigger: string;
      captions: Record<string, string>;
    };

    console.log(`Processing ${items.length} reference figures with Option B balanced colour distribution...`);

    const updatedCaptions: Record<string, string> = {};
    const updatedMetadataLines: string[] = [];
    const updatedIndexItems: ReferenceItem[] = [];

    for (const item of items) {
      const colourName = ASSIGNMENTS[item.name];
      if (!colourName) throw new Error(`Missing colour assignment for ${item.name}`);
      const colourHex = PALETTE[colourName];
      const modelId = subjectToId.get(item.name);
      if (!modelId) throw new Error(`Missing model record for ${item.name}`);

      const ar = this.readAspectRatio(modelId);
      const isSupported = SUPPORTED.has(item.name);

      await this.composePlane(item.file, colourHex, ar, isSupported);

      // Clean descriptive caption matching the exact prompt syntax
      const baseCaption = this.cleanBaseCaption(captionsManifest.captions[item.file] ?? item.name);
      const planeDescription = isSupported
        ? `supported by a short column on a flat matte ${colourName} paper plane of zero thickness matching its footprint`
        : `standing on a flat matte ${colourName} paper plane of zero thickness matching its footprint`;

      const fullCaption = `${baseCaption}, ${planeDescription}`;
      updatedCaptions[item.file] = fullCaption;

      const expandedText = `${captionsManifest.trigger}, ${fullCaption}. Seamless flat light grey #E5E5E5 background.`;
      updatedMetadataLines.push(JSON.stringify({ file_name: item.file, text: expandedText }));
      updatedIndexItems.push({ ...item, caption: expandedText });

      console.log(`  ✓ ${item.group}/${item.name.padEnd(18)} -> ${colourName.padEnd(8)} (AR: ${ar.toFixed(2)})`);
    }

    // Save manifests
    writeFileSync(this.captionsFile, JSON.stringify({ trigger: captionsManifest.trigger, captions: updatedCaptions }, null, 2));
    writeFileSync(this.metadataFile, `${updatedMetadataLines.join('\n')}\n`);
    writeFileSync(this.indexFile, JSON.stringify(updatedIndexItems, null, 2));

    console.log('\nManifests updated. Packaging LoRA dataset archive...');
    LoraDatasetBuilder.run();
  }

  private static readAspectRatio(modelId: string): number {
    const plinthFile = join(WorkspacePaths.resourcePath(modelId), 'stage-3/step-5-plinth.json');
    if (!existsSync(plinthFile)) return 1.5;
    const data = JSON.parse(readFileSync(plinthFile, 'utf8')) as { plinth: { bounds: [number, number, number, number] } };
    const [lx, hx, ly, hy] = data.plinth.bounds;
    return (hy - ly) / (hx - lx);
  }

  private static cleanBaseCaption(raw: string): string {
    return raw.replace(/,\s*(standing|supported|placed)\s+on\s+.*$/i, '').trim();
  }

  private static async composePlane(
    fileRel: string,
    colourHex: string,
    ar: number,
    isSupported: boolean,
  ): Promise<void> {
    const filePath = join(this.root, fileRel);
    const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
    const pixel = (idx: number): Rgb => [data[idx * 3], data[idx * 3 + 1], data[idx * 3 + 2]];
    const bg = borderColour(info.width, info.height, pixel);

    let minX = info.width;
    let maxX = 0;
    let minY = info.height;
    let maxY = 0;

    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = y * info.width + x;
        const p = pixel(idx);
        const d = Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
        const sat = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
        if (d > 45 || (d > 18 && sat > 10)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const figW = maxX - minX;
    const marginX = Math.max(6, Math.round(figW * 0.025));
    const xLeft = Math.max(4, minX - marginX);
    const xRight = Math.min(info.width - 4, maxX + marginX);
    const planeW = xRight - xLeft;

    const hRatio = Math.max(0.28, Math.min(0.46, 0.26 + 0.08 * Math.sqrt(ar)));
    const planeH = Math.round(planeW * hRatio);

    const yBottom = isSupported ? 475 : Math.min(info.height - 4, maxY + Math.max(4, Math.round(planeH * 0.035)));
    const yTop = yBottom - planeH;

    const cx = (xLeft + xRight) / 2;
    const deltaX = Math.round(planeW * 0.04);
    const xBottom = cx + deltaX;
    const xTop = cx - deltaX;

    const sRight = 0.44;
    const sLeft = 1 - sRight;
    const yRight = Math.round(yTop + sRight * planeH);
    const yLeft = Math.round(yTop + sLeft * planeH);

    const poly: readonly Point[] = [
      { x: xTop, y: yTop },
      { x: xRight, y: yRight },
      { x: xBottom, y: yBottom },
      { x: xLeft, y: yLeft },
    ];

    const colRadius = 14;
    const colX = cx;
    const colYTop = maxY - 15;
    const colYBottom = Math.round(yTop + 0.5 * planeH);

    const planeRgb = fromHex(colourHex);
    const outBuf = Buffer.alloc(info.width * info.height * 3);

    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = y * info.width + x;
        const p = pixel(idx);
        const d = Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
        const sat = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);

        let bodyAlpha = 0;
        if (d > 45 || (d > 18 && sat > 10)) {
          bodyAlpha = Math.min(1.0, (d - 18) / 20);
        }

        const isInside = insidePoly(x, y, poly);
        const edgeDist = distToPoly(x, y, poly);
        let planeAlpha = 0;
        if (isInside) {
          planeAlpha = edgeDist < 1.5 ? 0.5 + edgeDist / 3.0 : 1.0;
        } else if (edgeDist < 1.5) {
          planeAlpha = Math.max(0, 0.5 - edgeDist / 3.0);
        }

        let colAlpha = 0;
        let colR = 215;
        let colG = 200;
        let colB = 165;
        if (isSupported && x >= colX - colRadius && x <= colX + colRadius && y >= colYTop && y <= colYBottom) {
          if (x < colX) {
            colR = 225;
            colG = 210;
            colB = 175;
          } else {
            colR = 195;
            colG = 180;
            colB = 145;
          }
          const dxEdge = Math.min(x - (colX - colRadius), colX + colRadius - x);
          colAlpha = Math.min(1.0, dxEdge / 1.5);
        }

        let r = bg[0] * (1 - planeAlpha) + planeRgb[0] * planeAlpha;
        let g = bg[1] * (1 - planeAlpha) + planeRgb[1] * planeAlpha;
        let b = bg[2] * (1 - planeAlpha) + planeRgb[2] * planeAlpha;

        if (colAlpha > 0) {
          r = r * (1 - colAlpha) + colR * colAlpha;
          g = g * (1 - colAlpha) + colG * colAlpha;
          b = b * (1 - colAlpha) + colB * colAlpha;
        }

        outBuf[idx * 3] = Math.round(r * (1 - bodyAlpha) + p[0] * bodyAlpha);
        outBuf[idx * 3 + 1] = Math.round(g * (1 - bodyAlpha) + p[1] * bodyAlpha);
        outBuf[idx * 3 + 2] = Math.round(b * (1 - bodyAlpha) + p[2] * bodyAlpha);
      }
    }

    await sharp(outBuf, { raw: { width: info.width, height: info.height, channels: 3 } })
      .jpeg({ quality: 96 })
      .toFile(filePath);
  }
}

if (process.argv[1]?.includes('render-reference-planes')) {
  RenderReferencePlanes.run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
