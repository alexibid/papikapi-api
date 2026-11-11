import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import type { EyeSettings } from './interfaces/eyes.interface.js';

export interface ArtEyeFiles {
  readonly art_cutout: string;
  readonly art_eye_json: string;
  readonly art_eye_mask: string;
}

export class ArtEyeFinder {
  private static readonly script = 'scripts/stage-3/python/find_art_eye.py';

  public static withArtEye<T>(artCutout: string, settings: EyeSettings, use: (files: ArtEyeFiles) => T): T {
    const work = mkdtempSync(join(tmpdir(), 'papikapi-art-eye-'));
    try {
      return use(this.find(artCutout, settings, work));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  private static find(artCutout: string, settings: EyeSettings, work: string): ArtEyeFiles {
    const files = {
      art_cutout: artCutout,
      art_eye_json: join(work, 'art-eye.json'),
      art_eye_mask: join(work, 'art-eye-mask.png'),
    };
    const outcome = spawnSync('python3', [
      join(WorkspacePaths.appRoot, this.script), '--art', artCutout, '--settings', JSON.stringify(settings),
      '--out-json', files.art_eye_json, '--out-mask', files.art_eye_mask,
    ], { encoding: 'utf8' });
    if (outcome.status !== 0) {
      throw new Error(`Art eye search failed: ${outcome.stderr}`);
    }
    return files;
  }
}
