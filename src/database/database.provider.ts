import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ApiConfigService } from '../config/config.service.js';
import * as schema from './schema.js';
import { ensureStepRuns } from './step-runs.sql.js';

export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

export const databaseProviders = [
  {
    provide: DRIZZLE_DB,
    useFactory: (configService: ApiConfigService) => {
      const dbPath = configService.databasePath;
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const sqlite = new Database(dbPath);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');

      sqlite.exec(`
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

        CREATE TABLE IF NOT EXISTS model_files (
          id TEXT PRIMARY KEY,
          model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
          stage_id TEXT,
          file_type TEXT NOT NULL,
          path TEXT NOT NULL,
          size_bytes INTEGER DEFAULT 0,
          mime_type TEXT,
          created_at TEXT NOT NULL
        );

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

        CREATE TABLE IF NOT EXISTS prompts (
          id TEXT PRIMARY KEY,
          step_id TEXT NOT NULL,
          model_id TEXT REFERENCES models(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS behaviour_vocabulary (
          id TEXT PRIMARY KEY,
          word TEXT NOT NULL UNIQUE,
          lemma TEXT,
          anchor TEXT NOT NULL,
          domain TEXT NOT NULL,
          base_weight INTEGER NOT NULL DEFAULT 2,
          polarity TEXT NOT NULL DEFAULT 'positive',
          model_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS behaviour_rules (
          id TEXT PRIMARY KEY,
          pattern TEXT NOT NULL,
          anchor TEXT NOT NULL,
          domain TEXT NOT NULL,
          bonus_points INTEGER NOT NULL DEFAULT 1,
          explanation_template TEXT NOT NULL,
          model_version INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS behaviour_model_versions (
          id TEXT PRIMARY KEY,
          version_number INTEGER NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 0,
          compiled_snapshot TEXT NOT NULL,
          checksum TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_prompts_model_id ON prompts(model_id);
        CREATE INDEX IF NOT EXISTS idx_model_stages_model_id ON model_stages(model_id);
        CREATE INDEX IF NOT EXISTS idx_model_stages_stage_id ON model_stages(stage_id);
      `);

      try {
        sqlite.exec('ALTER TABLE models ADD COLUMN assembly_plan TEXT');
      } catch {}
      try {
        sqlite.exec('ALTER TABLE models ADD COLUMN display_name_pt TEXT');
      } catch {}
      try {
        sqlite.exec('ALTER TABLE models ADD COLUMN display_name_en TEXT');
      } catch {}

      ensureStepRuns(sqlite);

      return drizzle(sqlite, { schema });
    },
    inject: [ApiConfigService],
  },
];
