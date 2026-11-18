import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { PipelineConfig } from '../common/interfaces/index.js';

interface StepPromptRow {
  readonly id: string;
  readonly stepId: string;
  readonly content: string;
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE_DATE = '2026-01-01T00:00:00.000Z';

const SCHEMA = `
  CREATE TABLE models (
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    assembly_plan TEXT,
    display_name_pt TEXT,
    display_name_en TEXT
  );
  CREATE TABLE prompts (
    id TEXT PRIMARY KEY,
    step_id TEXT NOT NULL,
    model_id TEXT REFERENCES models(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export function pipelineConfigFixture(): PipelineConfig {
  const parsed: unknown = JSON.parse(readFixture('pipeline-config.json'));
  if (!isPipelineConfig(parsed)) throw new Error('pipeline-config.json is not a pipeline configuration');
  return parsed;
}

export function fixtureDatabase(): Database.Database {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(SCHEMA);
  const insert = database.prepare(
    'INSERT INTO prompts (id, step_id, model_id, content, updated_at) VALUES (@id, @stepId, NULL, @content, @updatedAt)',
  );
  stepPromptsFixture().forEach((row) => insert.run({ ...row, updatedAt: FIXTURE_DATE }));
  return database;
}

function stepPromptsFixture(): readonly StepPromptRow[] {
  const parsed: unknown = JSON.parse(readFixture('step-prompts.json'));
  if (!Array.isArray(parsed) || !parsed.every(isStepPromptRow)) {
    throw new Error('step-prompts.json is not a list of step prompts');
  }
  return parsed;
}

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

function isPipelineConfig(value: unknown): value is PipelineConfig {
  return typeof value === 'object' && value !== null && 'pipeline_stages' in value && Array.isArray(value.pipeline_stages);
}

function isStepPromptRow(value: unknown): value is StepPromptRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'stepId' in value &&
    typeof value.stepId === 'string' &&
    'content' in value &&
    typeof value.content === 'string'
  );
}
