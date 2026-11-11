import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PlaneColour } from './plane-colour.js';

const PALETTE = {
  black: '#202020', blue: '#2E5BD8', red: '#D33A2C', green: '#2E9E4F',
  orange: '#F08A24', purple: '#7B4FC2', yellow: '#F2C230',
};

/** A light grey picture with a figure: a body of one colour standing on legs of another. */
async function figure(body: string, legs: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <rect width="200" height="200" fill="#E5E5E5"/>
    <rect x="60" y="30" width="80" height="90" fill="${body}"/>
    <rect x="60" y="120" width="80" height="50" fill="${legs}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe('PlaneColour', () => {
  it('keeps the plane far from blue legs, the zombie case', async () => {
    const bytes = await figure('#3FA0D8', '#2B4FC0');
    const colour = await PlaneColour.choose('a zombie', [{ mime: 'image/jpeg', bytes }], PALETTE);
    expect(['blue', 'purple']).not.toContain(colour);
  });

  it('never puts a black figure on a black plane', async () => {
    const bytes = await figure('#1E1E1E', '#1E1E1E');
    expect(await PlaneColour.choose('a black cat', [{ mime: 'image/jpeg', bytes }], PALETTE)).not.toBe('black');
  });

  it('reads the colours of the prompt when there is no reference', async () => {
    const colour = await PlaneColour.choose('a cute orange fox with black paws', [], PALETTE);
    expect(['orange', 'black', 'red', 'yellow']).not.toContain(colour);
  });
});
