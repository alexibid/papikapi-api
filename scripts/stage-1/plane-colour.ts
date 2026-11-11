import sharp from 'sharp';
import type { InlineImage } from '../shared/common/interfaces/index.js';

export type Rgb = readonly [number, number, number];

/** The plane colours FLUX may be given, by name; white and grey are left out, the background is light grey. */
export type PlanePalette = Readonly<Record<string, string>>;

export interface FigureColours {
  readonly feet: readonly Rgb[];
  readonly body: readonly Rgb[];
}

const SAMPLE_PX = 96;
const BACKGROUND_DISTANCE = 40;
const FEET_SHARE = 0.3;
const COLOUR_SHARE_MIN = 0.05;
const QUANTUM = 32;
const BODY_WEIGHT = 0.25;

const COLOUR_WORDS: Readonly<Record<string, Rgb>> = {
  white: [240, 240, 240], branco: [240, 240, 240], branca: [240, 240, 240],
  black: [25, 25, 25], preto: [25, 25, 25], preta: [25, 25, 25],
  grey: [128, 128, 128], gray: [128, 128, 128], cinzento: [128, 128, 128], cinza: [128, 128, 128],
  brown: [120, 70, 35], castanho: [120, 70, 35], castanha: [120, 70, 35],
  red: [205, 45, 40], vermelho: [205, 45, 40], vermelha: [205, 45, 40],
  orange: [240, 135, 35], laranja: [240, 135, 35],
  yellow: [240, 200, 40], amarelo: [240, 200, 40], amarela: [240, 200, 40], golden: [230, 190, 90],
  green: [45, 150, 70], verde: [45, 150, 70],
  blue: [45, 90, 210], azul: [45, 90, 210],
  purple: [125, 75, 190], roxo: [125, 75, 190], lilac: [180, 150, 220], lilás: [180, 150, 220],
  pink: [240, 150, 180], rosa: [240, 150, 180],
  cream: [240, 225, 190], creme: [240, 225, 190], beige: [215, 190, 150], fawn: [215, 180, 130],
};

/**
 * The plane colour is chosen here, never by FLUX: left to pick from a list it falls back on lilac and blue, often the
 * colour of the paws. The figure's colours come from its references (the pixels unlike the image border, the lowest
 * part counting as feet), else from the colour words of the prompt; the plane is the palette colour furthest from the
 * feet in Lab, the rest of the figure breaking ties.
 */
export class PlaneColour {
  public static async choose(
    prompt: string,
    references: readonly InlineImage[],
    palette: PlanePalette,
  ): Promise<string> {
    const colours = references.length > 0 ? await this.fromImage(references[0].bytes) : this.fromWords(prompt);
    const candidates = Object.entries(palette).map(([name, hex]) => ({ name, lab: toLab(fromHex(hex)) }));
    const feet = (colours.feet.length > 0 ? colours.feet : colours.body).map(toLab);
    const body = colours.body.map(toLab);
    const scored = candidates.map(({ name, lab }) => ({
      name,
      score: nearest(lab, feet) + BODY_WEIGHT * nearest(lab, body),
    }));
    return scored.reduce((best, next) => (next.score > best.score ? next : best)).name;
  }

  public static fromWords(prompt: string): FigureColours {
    const words = prompt.toLowerCase().split(/[^a-zà-ú]+/);
    const body = words.flatMap((word) => (COLOUR_WORDS[word] ? [COLOUR_WORDS[word]] : []));
    return { feet: [], body };
  }

  public static async fromImage(bytes: Buffer): Promise<FigureColours> {
    const { data, info } = await sharp(bytes).flatten({ background: '#ffffff' })
      .resize(SAMPLE_PX, SAMPLE_PX, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const pixel = (index: number): Rgb => [data[index * 3], data[index * 3 + 1], data[index * 3 + 2]];
    const border = borderColour(info.width, info.height, pixel);
    const figure: { row: number; colour: Rgb }[] = [];
    for (let index = 0; index < info.width * info.height; index++) {
      const colour = pixel(index);
      if (distance(colour, border) > BACKGROUND_DISTANCE) figure.push({ row: Math.floor(index / info.width), colour });
    }
    if (figure.length === 0) return { feet: [], body: [] };
    const rows = figure.map((entry) => entry.row);
    const lowest = Math.max(...rows) - (Math.max(...rows) - Math.min(...rows)) * FEET_SHARE;
    return {
      feet: dominant(figure.filter((entry) => entry.row >= lowest).map((entry) => entry.colour)),
      body: dominant(figure.map((entry) => entry.colour)),
    };
  }
}

function borderColour(width: number, height: number, pixel: (index: number) => Rgb): Rgb {
  const edge: Rgb[] = [];
  for (let col = 0; col < width; col++) edge.push(pixel(col), pixel((height - 1) * width + col));
  for (let row = 0; row < height; row++) edge.push(pixel(row * width), pixel(row * width + width - 1));
  const median = (channel: number): number =>
    edge.map((rgb) => rgb[channel]).sort((a, b) => a - b)[edge.length >> 1];
  return [median(0), median(1), median(2)];
}

/** The colours that cover at least a twentieth of the pixels, each as the mean of its bin. */
function dominant(colours: readonly Rgb[]): readonly Rgb[] {
  const bins = new Map<string, Rgb[]>();
  for (const colour of colours) {
    const key = colour.map((channel) => Math.floor(channel / QUANTUM)).join(',');
    bins.set(key, [...(bins.get(key) ?? []), colour]);
  }
  return [...bins.values()]
    .filter((members) => members.length >= colours.length * COLOUR_SHARE_MIN)
    .map(meanOf);
}

function meanOf(members: readonly Rgb[]): Rgb {
  const mean = (channel: number): number => members.reduce((total, rgb) => total + rgb[channel], 0) / members.length;
  return [mean(0), mean(1), mean(2)];
}

function nearest(lab: Rgb, others: readonly Rgb[]): number {
  return others.length === 0 ? 0 : Math.min(...others.map((other) => distance(lab, other)));
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function fromHex(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toLab([red, green, blue]: Rgb): Rgb {
  const linear = [red, green, blue].map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124 * linear[0] + 0.3576 * linear[1] + 0.1805 * linear[2]) / 0.9505;
  const y = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const z = (0.0193 * linear[0] + 0.1192 * linear[1] + 0.9505 * linear[2]) / 1.089;
  const curve = (value: number): number => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  return [116 * curve(y) - 16, 500 * (curve(x) - curve(y)), 200 * (curve(y) - curve(z))];
}
