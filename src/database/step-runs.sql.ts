/**
 * Every execution of a pipeline step, kept forever, so costs and times count repeated runs, each with the app
 * version (package.json) it ran with. Shared by the API and the pipeline scripts, which both open the database.
 * The first time the table appears it is seeded with the latest run of each step already stored in model_stages:
 * older repeats were never recorded.
 */
export const STEP_RUNS_SQL = `
  CREATE TABLE IF NOT EXISTS step_runs (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    stage_id TEXT NOT NULL,
    status TEXT NOT NULL,
    seconds REAL NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    cost_note TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    app_version TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_step_runs_model_id ON step_runs(model_id);
  CREATE INDEX IF NOT EXISTS idx_step_runs_stage_id ON step_runs(stage_id);
  INSERT INTO step_runs (id, model_id, stage_id, status, seconds, cost_usd, cost_note, started_at, finished_at)
  SELECT model_id || ':' || stage_id || ':seed', model_id, stage_id, status, COALESCE(seconds, 0),
         COALESCE(cost_usd, 0), cost_note,
         strftime('%Y-%m-%dT%H:%M:%fZ', timestamp, '-' || COALESCE(seconds, 0) || ' seconds'), timestamp
  FROM model_stages
  WHERE timestamp IS NOT NULL AND model_id IN (SELECT id FROM models) AND NOT EXISTS (SELECT 1 FROM step_runs);
`;

const VERSION_COLUMNS = ['app_version'] as const;

export interface SqlExecutor {
  exec(sql: string): unknown;
  prepare(sql: string): { all(): unknown[] };
}

/** Creates the table and adds the version column to a table made before it existed. */
export function ensureStepRuns(db: SqlExecutor): void {
  db.exec(STEP_RUNS_SQL);
  const columns = db.prepare('PRAGMA table_info(step_runs)').all()
    .map((column) => (typeof column === 'object' && column !== null && 'name' in column ? String(column.name) : ''));
  for (const name of VERSION_COLUMNS.filter((version) => !columns.includes(version))) {
    db.exec(`ALTER TABLE step_runs ADD COLUMN ${name} TEXT`);
  }
}
