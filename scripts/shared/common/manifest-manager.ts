import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { ensureStepRuns } from '../../../src/database/step-runs.sql.js';
import type { ModelManifest, StepRecord, StepRecordInput } from './interfaces/index.js';
import { WorkspacePaths } from './workspace-paths.js';

interface StepRun {
  readonly subject: string;
  readonly stageId: string;
  readonly record: StepRecordInput;
  readonly finishedAt: string;
}

export class ManifestManager {
  private static readonly manifestVersion = 1;

  private static getDatabase(): Database.Database {
    const dbPath = join(WorkspacePaths.resourcesDir, 'papikapi.db');
    const dir = WorkspacePaths.resourcesDir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 30000');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        flux_prompt TEXT,
        status TEXT NOT NULL DEFAULT 'DONE',
        chosen_pick INTEGER,
        total_seconds REAL DEFAULT 0,
        total_cost_usd REAL DEFAULT 0,
        primary_mesh_path TEXT,
        sheet_path TEXT,
        preview_path TEXT,
        assembly_plan TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_stages (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL,
        status TEXT NOT NULL,
        seconds REAL DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        cost_note TEXT,
        parameters TEXT,
        metrics TEXT,
        data TEXT,
        timestamp TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_model_stages_model_id ON model_stages(model_id);
      CREATE INDEX IF NOT EXISTS idx_model_stages_stage_id ON model_stages(stage_id);

      CREATE TABLE IF NOT EXISTS pipeline_versions (
        id TEXT PRIMARY KEY,
        version_number INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        config TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    try {
      db.exec('ALTER TABLE models ADD COLUMN assembly_plan TEXT');
    } catch {}
    ensureStepRuns(db);

    return db;
  }

  public static readStepResult(subject: string, stageId: string): StepRecord | null {
    try {
      const db = this.getDatabase();
      const row = db
        .prepare('SELECT * FROM model_stages WHERE model_id = ? AND stage_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1')
        .get(subject, stageId) as
        | {
            stage_id: string;
            status: string;
            seconds: number;
            cost_usd: number;
            cost_note?: string;
            metrics?: string;
            data?: string;
            timestamp?: string;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        stageId: row.stage_id,
        status: row.status,
        seconds: row.seconds,
        costUsd: row.cost_usd,
        at: row.timestamp,
        ...(row.cost_note ? { costNote: row.cost_note } : {}),
        ...(row.metrics ? { metrics: JSON.parse(row.metrics) } : {}),
        ...(row.data ? { data: JSON.parse(row.data) } : {}),
      };
    } catch {
      return null;
    }
  }

  public static writeStepResult(
    subject: string,
    stageId: string,
    record: StepRecordInput
  ): ModelManifest {
    const db = this.getDatabase();
    const now = record.at ?? new Date().toISOString();
    const stageDbId = `${subject}-${stageId}`;

    const upsertStage = db.prepare(`
      INSERT INTO model_stages (id, model_id, stage_id, status, seconds, cost_usd, cost_note, metrics, data, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        seconds = excluded.seconds,
        cost_usd = excluded.cost_usd,
        cost_note = excluded.cost_note,
        metrics = excluded.metrics,
        data = excluded.data,
        timestamp = excluded.timestamp
    `);

    upsertStage.run(
      stageDbId,
      subject,
      stageId,
      record.status,
      Math.round(record.seconds * 1000) / 1000,
      record.costUsd,
      record.costNote ?? null,
      record.metrics ? JSON.stringify(record.metrics) : null,
      record.data ? JSON.stringify(record.data) : null,
      now
    );

    const allStages = db
      .prepare('SELECT * FROM model_stages WHERE model_id = ?')
      .all(subject) as Array<{
        stage_id: string;
        seconds: number;
        cost_usd: number;
        data?: string;
      }>;

    const totalSeconds =
      Math.round(allStages.reduce((acc, s) => acc + (s.seconds || 0), 0) * 1000) / 1000;
    const totalCostUsd =
      Math.round(allStages.reduce((acc, s) => acc + (s.cost_usd || 0), 0) * 10000) / 10000;

    let fluxPrompt: string | null = null;
    let chosenPick: number | null = null;

    for (const s of allStages) {
      if (!s.data) continue;
      try {
        const d = JSON.parse(s.data);
        if (s.stage_id === 's1-step-1') {
          fluxPrompt = fluxPrompt || d.fluxPrompt || null;
        }
        if (s.stage_id === 's1-step-2') {
          chosenPick = chosenPick ?? d.chosenPick ?? null;
        }
      } catch {}
    }

    const upsertModel = db.prepare(`
      INSERT INTO models (id, subject, flux_prompt, status, chosen_pick, total_seconds, total_cost_usd, created_at, updated_at)
      VALUES (@id, @subject, @fluxPrompt, 'DONE', @chosenPick, @totalSeconds, @totalCostUsd, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        flux_prompt = COALESCE(@fluxPrompt, models.flux_prompt),
        chosen_pick = COALESCE(@chosenPick, models.chosen_pick),
        total_seconds = @totalSeconds,
        total_cost_usd = @totalCostUsd,
        updated_at = @now
    `);

    upsertModel.run({
      id: subject,
      subject,
      fluxPrompt,
      chosenPick,
      totalSeconds,
      totalCostUsd,
      now,
    });
    this.recordRun(db, { subject, stageId, record, finishedAt: now });

    return this.buildAggregateManifest(subject);
  }

  /** One row per execution, never overwritten, so repeated runs keep counting in the totals. */
  private static recordRun(db: Database.Database, run: StepRun): void {
    const { subject, stageId, record, finishedAt } = run;
    const startedAt = new Date(new Date(finishedAt).getTime() - record.seconds * 1000).toISOString();
    db.prepare(
      `INSERT INTO step_runs (id, model_id, stage_id, status, seconds, cost_usd, cost_note, started_at, finished_at,
         app_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), subject, stageId, record.status, Math.round(record.seconds * 1000) / 1000,
      record.costUsd, record.costNote ?? null, startedAt, finishedAt, this.appVersion());
  }

  /** The papikapi-api version in its package.json: the code a run was made with. */
  public static appVersion(): string {
    const manifest: unknown = JSON.parse(readFileSync(join(WorkspacePaths.appRoot, 'package.json'), 'utf8'));
    const known = typeof manifest === 'object' && manifest !== null && 'version' in manifest;
    return known ? String(manifest.version) : 'unknown';
  }

  public static buildAggregateManifest(subject: string): ModelManifest {
    const db = this.getDatabase();
    const rows = db
      .prepare('SELECT * FROM model_stages WHERE model_id = ?')
      .all(subject) as Array<{
        stage_id: string;
        status: string;
        seconds: number;
        cost_usd: number;
        cost_note?: string;
        metrics?: string;
        data?: string;
        timestamp?: string;
      }>;

    const stages: Record<string, StepRecord> = {};
    for (const row of rows) {
      stages[row.stage_id] = {
        stageId: row.stage_id,
        status: row.status,
        seconds: row.seconds,
        costUsd: row.cost_usd,
        at: row.timestamp,
        ...(row.cost_note ? { costNote: row.cost_note } : {}),
        ...(row.metrics ? { metrics: JSON.parse(row.metrics) } : {}),
        ...(row.data ? { data: JSON.parse(row.data) } : {}),
      };
    }

    const stageList = Object.values(stages);
    const totalSeconds =
      Math.round(stageList.reduce((acc, s) => acc + (s.seconds !== undefined ? s.seconds : 0), 0) * 1000) / 1000;
    const totalCostUsd =
      Math.round(stageList.reduce((acc, s) => acc + (s.costUsd !== undefined ? s.costUsd : 0), 0) * 10000) / 10000;

    return {
      version: this.manifestVersion,
      subject,
      stages,
      totalSeconds,
      totalCostUsd,
      updatedAt: new Date().toISOString(),
    };
  }
}
