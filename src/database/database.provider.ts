import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ApiConfigService } from '../config/config.service.js';
import * as schema from './schema.js';

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
          prompt TEXT,
          flux_prompt TEXT,
          status TEXT NOT NULL DEFAULT 'DONE',
          chosen_pick INTEGER,
          total_seconds REAL DEFAULT 0,
          total_cost_usd REAL DEFAULT 0,
          primary_mesh_path TEXT,
          sheet_path TEXT,
          preview_path TEXT,
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

        CREATE INDEX IF NOT EXISTS idx_model_stages_model_id ON model_stages(model_id);
        CREATE INDEX IF NOT EXISTS idx_model_stages_stage_id ON model_stages(stage_id);
      `);

      return drizzle(sqlite, { schema });
    },
    inject: [ApiConfigService],
  },
];
