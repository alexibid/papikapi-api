import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { WorkspacePaths } from './workspace-paths.js';

/** One shared connection to resources/papikapi.db for the pipeline scripts. */
export class PapikapiDatabase {
  private static instance: Database.Database | undefined;

  private static readonly promptsTable = `
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      step_id TEXT NOT NULL,
      model_id TEXT REFERENCES models(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompts_model_id ON prompts(model_id);
  `;

  private static readonly displayNameColumns: readonly string[] = ['display_name_pt', 'display_name_en'];

  public static connection(): Database.Database {
    this.instance ??= this.open();
    return this.instance;
  }

  private static open(): Database.Database {
    mkdirSync(WorkspacePaths.resourcesDir, { recursive: true });
    const db = new Database(join(WorkspacePaths.resourcesDir, 'papikapi.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 30000');
    db.pragma('foreign_keys = ON');
    db.exec(this.promptsTable);
    this.addDisplayNameColumns(db);
    return db;
  }

  private static addDisplayNameColumns(db: Database.Database): void {
    const columns = new Set(
      db.prepare('PRAGMA table_info(models)').all().map((column) => (column as { readonly name: string }).name),
    );
    if (columns.size === 0) return;
    this.displayNameColumns
      .filter((column) => !columns.has(column))
      .forEach((column) => db.exec(`ALTER TABLE models ADD COLUMN ${column} TEXT`));
  }
}
