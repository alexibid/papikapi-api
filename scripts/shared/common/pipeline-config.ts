import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { PipelineConfig, PipelineStage, PipelineStep } from './interfaces/index.js';
import { WorkspacePaths } from './workspace-paths.js';

export class PipelineConfigLoader {
  private static cachedConfig: PipelineConfig | null = null;
  private static cachedVersion: string | null = null;

  public static load(requestedVersion?: string): PipelineConfig {
    const dbPath = join(WorkspacePaths.resourcesDir, 'papikapi.db');
    if (!existsSync(dbPath)) {
      throw new Error(`Database not found at ${dbPath}`);
    }

    const db = new Database(dbPath);
    let row: { id: string; config: string } | undefined;

    if (requestedVersion) {
      row = db.prepare('SELECT id, config FROM pipeline_versions WHERE id = ?').get(requestedVersion) as
        | { id: string; config: string }
        | undefined;
    } else {
      const activeSetting = db
        .prepare("SELECT value FROM system_settings WHERE key = 'active_pipeline_version'")
        .get() as { value: string } | undefined;
      const activeVersion = activeSetting?.value;
      if (activeVersion) {
        row = db.prepare('SELECT id, config FROM pipeline_versions WHERE id = ?').get(activeVersion) as
          | { id: string; config: string }
          | undefined;
      }
      if (!row) {
        row = db.prepare('SELECT id, config FROM pipeline_versions WHERE is_active = 1 LIMIT 1').get() as
          | { id: string; config: string }
          | undefined;
      }
      if (!row) {
        row = db
          .prepare('SELECT id, config FROM pipeline_versions ORDER BY version_number DESC LIMIT 1')
          .get() as { id: string; config: string } | undefined;
      }
    }

    if (!row) {
      throw new Error(`No pipeline configuration found in database (version: ${requestedVersion ?? 'active'})`);
    }

    if (this.cachedConfig && this.cachedVersion === row.id) {
      return this.cachedConfig;
    }

    this.cachedConfig = JSON.parse(row.config) as PipelineConfig;
    this.cachedVersion = row.id;
    return this.cachedConfig;
  }

  public static getStep(stepId: string): PipelineStep {
    const config = this.load();
    for (const stage of config.pipeline_stages) {
      const found = stage.steps.find((s) => s.id === stepId);
      if (found) {
        return found;
      }
    }
    throw new Error(`Step '${stepId}' not found in pipeline configuration`);
  }

  public static getStage(stageNumber: number): PipelineStage {
    const config = this.load();
    const stage = config.pipeline_stages.find((s) => s.stage.startsWith(`Stage ${stageNumber}:`));
    if (!stage) {
      throw new Error(`Stage ${stageNumber} not found in pipeline configuration`);
    }
    return stage;
  }
}
