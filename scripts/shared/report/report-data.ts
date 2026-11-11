import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ManifestManager } from '../common/manifest-manager.js';
import { WorkspacePaths } from '../common/workspace-paths.js';

export interface ReportFigure {
  readonly id: string;
  readonly name: string;
  readonly mode: string;
  readonly paperFaces: number | null;
  readonly artEyes: boolean;
  readonly seconds: number;
  readonly costUsd: number;
  readonly runs: number;
  readonly updatedAt: string;
  readonly version: string | null;
}

export interface ReportStep {
  readonly label: string;
  readonly avgSeconds: number;
  readonly avgCostUsd: number;
  readonly runs: number;
  readonly spentCostUsd: number;
}

export interface ReportContent {
  readonly currentVersion: string;
  readonly figures: readonly ReportFigure[];
  readonly steps: readonly ReportStep[];
  readonly spentCostUsd: number;
  readonly spentHours: number;
}

interface StepRow { readonly label: string; readonly id: string }

/** The figures and per-step statistics of the report, read straight from the pipeline database. */
export class ReportData {
  public static read(): ReportContent {
    const db = new Database(join(WorkspacePaths.resourcesDir, 'papikapi.db'), { readonly: true });
    try {
      const steps = this.pipelineSteps(db);
      const spent = db
        .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(seconds), 0) AS seconds FROM step_runs')
        .get() as { cost: number; seconds: number };
      return {
        currentVersion: ManifestManager.appVersion(),
        figures: this.figures(db, steps.map((step) => step.id)),
        steps: steps.map((step) => this.statistics(db, step)),
        spentCostUsd: spent.cost,
        spentHours: spent.seconds / 3600,
      };
    } finally {
      db.close();
    }
  }

  private static pipelineSteps(db: Database.Database): readonly StepRow[] {
    const row = db.prepare('SELECT config FROM pipeline_versions WHERE is_active = 1').get() as { config: string };
    const config = JSON.parse(row.config) as { pipeline_stages: { steps: { id: string; label?: string }[] }[] };
    return config.pipeline_stages.flatMap((stage) =>
      stage.steps.map((step) => ({ id: step.id, label: step.label ?? step.id })));
  }

  private static figures(db: Database.Database, stepIds: readonly string[]): readonly ReportFigure[] {
    const placeholders = stepIds.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT m.id, COALESCE(m.display_name_en, m.subject) AS name, m.updated_at AS updatedAt,
        (SELECT metrics FROM model_stages WHERE model_id = m.id AND stage_id = 's3-step-1') AS simplify,
        (SELECT metrics FROM model_stages WHERE model_id = m.id AND stage_id = 's3-step-3') AS atlas,
        (SELECT COALESCE(SUM(seconds), 0) FROM model_stages
          WHERE model_id = m.id AND stage_id IN (${placeholders})) AS seconds,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM step_runs WHERE model_id = m.id) AS costUsd,
        (SELECT COUNT(*) FROM step_runs WHERE model_id = m.id) AS runs,
        (SELECT app_version FROM step_runs
          WHERE model_id = m.id AND app_version IS NOT NULL ORDER BY finished_at ASC LIMIT 1) AS version
      FROM models m ORDER BY name COLLATE NOCASE`).all(...stepIds) as {
        id: string; name: string; updatedAt: string; simplify: string | null; atlas: string | null;
        seconds: number; costUsd: number; runs: number; version: string | null;
      }[];
    return rows.map((row) => {
      const simplify = row.simplify ? JSON.parse(row.simplify) as { mode?: string; meshFaces?: number } : {};
      const atlas = row.atlas ? JSON.parse(row.atlas) as { eyeTexels?: number } : {};
      return {
        id: row.id,
        name: row.name,
        updatedAt: row.updatedAt,
        seconds: row.seconds,
        costUsd: row.costUsd,
        runs: row.runs,
        version: row.version,
        mode: simplify.mode === 'boxes' ? 'boxes' : 'planar',
        paperFaces: simplify.meshFaces ?? null,
        artEyes: (atlas.eyeTexels ?? 0) > 0,
      };
    });
  }

  private static statistics(db: Database.Database, step: StepRow): ReportStep {
    const latest = db.prepare(`SELECT COALESCE(AVG(seconds), 0) AS seconds, COALESCE(AVG(cost_usd), 0) AS cost
      FROM model_stages WHERE stage_id = ? AND status = 'DONE'`).get(step.id) as { seconds: number; cost: number };
    const runs = db
      .prepare('SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost FROM step_runs WHERE stage_id = ?')
      .get(step.id) as { runs: number; cost: number };
    return {
      label: step.label,
      avgSeconds: latest.seconds,
      avgCostUsd: latest.cost,
      runs: runs.runs,
      spentCostUsd: runs.cost,
    };
  }
}
