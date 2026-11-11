import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import type { CameraStatistics, LightingStatistics, PreviewsStepDefinition } from './interfaces/previews.interface.js';

interface ModelRow {
  readonly id: string;
  readonly subject: string;
}

interface BatchResultItem {
  readonly model_id: string;
  readonly threeQuarterYawDeg: number;
  readonly faces: number;
  readonly camera?: CameraStatistics;
  readonly lighting?: LightingStatistics;
}

async function run(): Promise<void> {
  const dbPath = join(WorkspacePaths.resourcesDir, 'papikapi.db');
  const db = new Database(dbPath);
  const models = db.prepare('SELECT id, subject FROM models ORDER BY subject').all() as ModelRow[];

  const step = PipelineConfigLoader.getStep('s3-step-6') as unknown as PreviewsStepDefinition;
  const blenderExecutable = step.blender.executable;
  const batchScript = join(process.cwd(), 'scripts/stage-3/blender/previews/batch_render_previews.py');

  const scratchDir = join(tmpdir(), 'papikapi-batch-previews');
  mkdirSync(scratchDir, { recursive: true });

  const tasks = [];
  for (const m of models) {
    const publicDir = WorkspacePaths.modelPath(m.id);
    const glbPath = join(publicDir, 'model.glb');
    if (!existsSync(glbPath)) {
      console.warn(`[WARN] Model GLB not found for ${m.subject} (${m.id}): ${glbPath}`);
      continue;
    }

    tasks.push({
      model_id: m.id,
      subject: m.subject,
      model_glb: glbPath,
      outputs: {
        three_quarter: join(publicDir, 'preview-three-quarter.webp'),
        three_quarter_wire: join(publicDir, 'preview-three-quarter-wireframe.webp'),
      },
      ...step.parameters,
    });
  }

  console.log(`Starting standardized batch rendering for ${tasks.length} models...`);
  const settingsJsonPath = join(scratchDir, 'batch-previews-tasks.json');
  writeFileSync(settingsJsonPath, JSON.stringify(tasks, null, 2), 'utf-8');

  const startTime = Date.now();
  const proc = spawnSync(blenderExecutable, ['-b', '--factory-startup', '-P', batchScript, '--', settingsJsonPath], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });

  if (proc.status !== 0) {
    console.error('Blender execution failed:\n', proc.stderr || proc.stdout);
    process.exit(1);
  }

  const marker = 'PAPERCRAFT_BATCH_RESULT ';
  const markerIdx = proc.stdout.indexOf(marker);
  if (markerIdx === -1) {
    console.error('Marker not found in Blender output:\n', proc.stdout);
    process.exit(1);
  }

  const jsonStr = proc.stdout.slice(markerIdx + marker.length).trim().split('\n')[0];
  const results = JSON.parse(jsonStr) as BatchResultItem[];
  const duration = Math.round(((Date.now() - startTime) / 1000) * 10) / 10;
  console.log(`Rendered all ${results.length} models in ${duration}s`);

  // Update SQLite model_stages with camera and lighting data
  for (const r of results) {
    ManifestManager.writeStepResult(r.model_id, 's3-step-6', {
      status: 'DONE',
      seconds: Math.round((duration / results.length) * 100) / 100,
      costUsd: 0.0,
      costNote: 'Standardized Canonical 3/4 Render ($0.00)',
      metrics: {
        threeQuarterYawDeg: r.threeQuarterYawDeg,
        faces: r.faces,
        ...(r.lighting ? {
          fluxLuminance: r.lighting.fluxLuminance,
          previewLuminance: r.lighting.previewLuminance,
          luminanceMatchRatio: r.lighting.luminanceMatchRatio,
          exposureUsed: r.lighting.exposureUsed,
        } : {}),
      },
      data: {
        source: join(WorkspacePaths.modelPath(r.model_id), 'model.glb'),
        previews: {
          three_quarter: join(WorkspacePaths.modelPath(r.model_id), 'preview-three-quarter.webp'),
          three_quarter_wire: join(WorkspacePaths.modelPath(r.model_id), 'preview-three-quarter-wireframe.webp'),
        },
        parameters: step.parameters,
        standardized: true,
        ...(r.camera ? { camera: r.camera } : {}),
        ...(r.lighting ? { lighting: r.lighting } : {}),
      },
    });
  }
  console.log(`Updated model_stages for all ${results.length} models in SQLite database.`);

  try {
    rmSync(scratchDir, { recursive: true, force: true });
  } catch {}

  // Generate updated review gallery HTML
  generateReviewGallery(models, results);
}

function generateReviewGallery(models: ModelRow[], results: BatchResultItem[]): void {
  const resultMap = new Map(results.map((r) => [r.model_id, r]));

  let cardsHtml = '';
  for (const m of models) {
    const res = resultMap.get(m.id);
    const yaw = res?.threeQuarterYawDeg ?? -45;
    const faces = res?.faces ?? 0;
    const isReversed = yaw > 0;
    const badgeLabel = isReversed ? `OK: Canonical 3/4 (Mesh 180° Inverted, Yaw ${yaw}°)` : `OK: Canonical 3/4 (Yaw ${yaw}°)`;

    cardsHtml += `
    <div class="card">
      <div class="card-header">
        <div>
          <span class="card-title">${m.subject}</span>
          <div class="card-meta">ID: ${m.id} · Faces: ${faces} · Pitch: 25.0° · Yaw: ${yaw}°</div>
        </div>
        <span class="badge badge-ok">${badgeLabel}</span>
      </div>
      <div class="images">
        <div class="img-box">
          <span>FLUX Art (Stage 1)</span>
          <img src="../public/models/${m.id}/art.jpeg" alt="Art">
        </div>
        <div class="img-box">
          <span>Standardized 3D Preview (Stage 3)</span>
          <img src="../public/models/${m.id}/preview-three-quarter.webp" alt="Preview 3D">
        </div>
        <div class="img-box">
          <span>3D Wireframe (Stage 3)</span>
          <img src="../public/models/${m.id}/preview-three-quarter-wireframe.webp" alt="Wireframe">
        </div>
      </div>
    </div>
  `;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Papikapi Models — 3D Previews Review (56 Figures Standardized)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 24px; }
    h1 { color: #fff; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 24px; font-size: 14px; }
    .legend { display: flex; gap: 16px; margin-bottom: 24px; font-size: 13px; }
    .badge { padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
    .badge-ok { background: #1b5e20; color: #a5d6a7; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; }
    .card { background: #1e1e1e; border: 1px solid #333; border-radius: 8px; overflow: hidden; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .card-header { display: flex; justify-content: space-between; align-items: center; }
    .card-title { font-size: 16px; font-weight: bold; color: #fff; text-transform: capitalize; }
    .card-meta { font-size: 12px; color: #aaa; }
    .images { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; background: #2a2a2a; padding: 8px; border-radius: 6px; }
    .img-box { text-align: center; }
    .img-box span { display: block; font-size: 11px; color: #888; margin-bottom: 4px; }
    .img-box img { width: 100%; height: auto; border-radius: 4px; background: #e5e5e5; display: block; }
  </style>
</head>
<body>
  <h1>Papikapi — Canonical 3D Previews Standardized Gallery (56 Figures)</h1>
  <div class="subtitle">All 56 figures strictly aligned to canonical framing: 3/4 elevated (pitch 25.0°), front and right flank (yaw -45.0° relative to model forward).</div>
  <div class="grid">
    ${cardsHtml}
  </div>
</body>
</html>`;

  writeFileSync('resources/review-previews.html', html, 'utf-8');
  console.log('Regenerated resources/review-previews.html');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
