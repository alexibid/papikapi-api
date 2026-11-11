import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ModelRow } from './model-row.js';

describe('ModelRow', () => {
  let writes: string[] = [];
  const originalWrite = process.stdout.write;
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    writes = [];
    process.stdout.columns = 150; // set standard terminal width for tests
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.stdout.columns = originalColumns;
  });

  it('renders all pending slots in grey on initialization', () => {
    const row = new ModelRow('[01/01] TEST', ['ALTERNATIVES', 'PICK', 'TRELLIS-IN'], true);
    row.begin();

    const output = writes.join('');
    expect(output).toContain('\x1b[90m'); // GREY
    expect(output).toContain('ALTS');
    expect(output).toContain('PICK');
    expect(output).toContain('TRELLIS');
  });

  it('renders running slot in bright white and approaching slot in light white', () => {
    const row = new ModelRow('[01/01] TEST', ['ALTERNATIVES', 'PICK', 'TRELLIS-IN'], true);
    row.begin();
    writes = [];

    row.running('ALTERNATIVES');
    const output = writes.join('');

    // Running: bright bold white \x1b[1;97m with ⟳
    expect(output).toContain('\x1b[1;97m⟳ ALTS\x1b[0m');
    // Approaching: light crisp white \x1b[37m
    expect(output).toContain('\x1b[37mPICK\x1b[0m');
    // Distant pending: grey \x1b[90m
    expect(output).toContain('\x1b[90mTRELLIS\x1b[0m');
  });

  it('renders sub-status message strictly on the line underneath with cyan arrow', () => {
    const row = new ModelRow('[01/01] TEST', ['ALTERNATIVES', 'PICK'], true);
    row.begin();
    writes = [];

    row.running('ALTERNATIVES');
    row.subStatus('[RunPod Serverless] Generating alternatives on FLUX.2...');

    const lastWrite = writes[writes.length - 1];
    expect(lastWrite).toContain('\n');
    const [graphLine, subLine] = lastWrite.split('\n');
    expect(graphLine).toContain('ALTS');
    expect(subLine).toContain('↳');
    expect(subLine).toContain('[RunPod Serverless] Generating alternatives on FLUX.2...');
  });

  it('clears sub-status when step finishes and updates slot to green checkmark', () => {
    const row = new ModelRow('[01/01] TEST', ['ALTERNATIVES', 'PICK'], true);
    row.begin();
    row.running('ALTERNATIVES');
    row.subStatus('[RunPod Serverless] Processing...');
    writes = [];

    row.finish('ALTERNATIVES', 'DONE', 38.4);
    const lastWrite = writes[writes.length - 1];

    // Subline is gone (no \n)
    expect(lastWrite).not.toContain('\n');
    // ALTERNATIVES is green ✔
    expect(lastWrite).toContain('\x1b[32m✔ ALTS 38.4s\x1b[0m');
  });

  it('ensures lines do not exceed terminal width', () => {
    process.stdout.columns = 120;
    const row = new ModelRow(
      '[01/01] ANKYLOSAURUS',
      [
        'ALTERNATIVES',
        'PICK',
        'TRELLIS-IN',
        '3D-GLB',
        'DETAILS',
        'SIMPLIFY',
        'ATLAS',
        'TEXTURIZE',
        'PLINTH',
        'UNFOLD',
        'SHEETS',
        'ASSEMBLY',
      ],
      true,
    );
    row.begin();
    const lastWrite = writes[writes.length - 1];

    const visibleText = lastWrite.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g'), '');
    expect(visibleText.length).toBeLessThanOrEqual(120);
  });
});
