import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { CatalogueModelEntry } from './interfaces/index.js';
import { FigureRegistry } from './figure-registry.js';
import { PipelineConfigLoader } from './pipeline-config.js';
import { WorkspacePaths } from './workspace-paths.js';

export class CatalogueManager {
  public static sync(): readonly CatalogueModelEntry[] {
    if (!existsSync(WorkspacePaths.publicModelsDir)) {
      return [];
    }

    const step2 = PipelineConfigLoader.getStep('s1-step-2');
    const step3 = PipelineConfigLoader.getStep('s2-step-2');
    const glbFilename = step3.outputs.model_public;
    const artFilename = step2.outputs.art_public;

    const entries = readdirSync(WorkspacePaths.publicModelsDir, { withFileTypes: true });
    const verifiedModels: CatalogueModelEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.startsWith('.')) {
        continue;
      }

      const modelId = entry.name;
      const modelDir = join(WorkspacePaths.publicModelsDir, modelId);
      const glbPath = join(modelDir, glbFilename);
      const artPath = join(modelDir, artFilename);

      if (
        existsSync(glbPath) &&
        existsSync(artPath) &&
        statSync(glbPath).size > 1000
      ) {
        verifiedModels.push({
          id: modelId,
          displayName: FigureRegistry.identityOf(modelId).displayName,
          model: glbFilename,
          preview: artFilename,
          image: artFilename,
        });
      }
    }

    verifiedModels.sort((a, b) => a.id.localeCompare(b.id));

    // Sync directly to SQLite database if available
    const dbPath = join(WorkspacePaths.resourcesDir, 'papikapi.db');
    if (existsSync(dbPath)) {
      try {
        const db = new Database(dbPath);
        const now = new Date().toISOString();
        const upsert = db.prepare(`
          INSERT INTO models (id, subject, status, primary_mesh_path, sheet_path, preview_path, created_at, updated_at)
          VALUES (@id, @subject, 'DONE', @primaryMeshPath, @sheetPath, @previewPath, @now, @now)
          ON CONFLICT(id) DO UPDATE SET
            primary_mesh_path = @primaryMeshPath,
            sheet_path = @sheetPath,
            preview_path = @previewPath
        `);

        for (const m of verifiedModels) {
          upsert.run({
            id: m.id,
            subject: m.id,
            primaryMeshPath: `/api/v1/models/${m.id}/mesh`,
            sheetPath: `/api/v1/models/${m.id}/sheet`,
            previewPath: `/models/${m.id}/${m.preview}`,
            now,
          });
        }
      } catch {
        // Non-fatal if sqlite cannot be synced
      }
    }

    return verifiedModels;
  }
}

if (process.argv[1] && process.argv[1].endsWith('catalogue-manager.ts')) {
  const models = CatalogueManager.sync();
  console.log(`Synced catalogue with ${models.length} verified model(s): ${models.map((m) => m.id).join(', ')}`);
}
