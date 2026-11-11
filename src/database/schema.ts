import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const modelsTable = sqliteTable('models', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull(),
  displayNamePt: text('display_name_pt'),
  displayNameEn: text('display_name_en'),
  fluxPrompt: text('flux_prompt'),
  status: text('status').notNull().default('DONE'),
  chosenPick: integer('chosen_pick'),
  totalSeconds: real('total_seconds').default(0),
  totalCostUsd: real('total_cost_usd').default(0),
  primaryMeshPath: text('primary_mesh_path'),
  sheetPath: text('sheet_path'),
  previewPath: text('preview_path'),
  assemblyPlan: text('assembly_plan'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const modelStagesTable = sqliteTable('model_stages', {
  id: text('id').primaryKey(),
  modelId: text('model_id')
    .notNull()
    .references(() => modelsTable.id, { onDelete: 'cascade' }),
  stageId: text('stage_id').notNull(),
  status: text('status').notNull(),
  seconds: real('seconds').default(0),
  costUsd: real('cost_usd').default(0),
  costNote: text('cost_note'),
  parameters: text('parameters'),
  metrics: text('metrics'),
  data: text('data'),
  timestamp: text('timestamp'),
});

export const stepRunsTable = sqliteTable('step_runs', {
  id: text('id').primaryKey(),
  modelId: text('model_id')
    .notNull()
    .references(() => modelsTable.id, { onDelete: 'cascade' }),
  stageId: text('stage_id').notNull(),
  status: text('status').notNull(),
  seconds: real('seconds').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  costNote: text('cost_note'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at').notNull(),
  appVersion: text('app_version'),
});

export const modelFilesTable = sqliteTable('model_files', {
  id: text('id').primaryKey(),
  modelId: text('model_id')
    .notNull()
    .references(() => modelsTable.id, { onDelete: 'cascade' }),
  stageId: text('stage_id'),
  fileType: text('file_type').notNull(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes').default(0),
  mimeType: text('mime_type'),
  createdAt: text('created_at').notNull(),
});

export const pipelineVersionsTable = sqliteTable('pipeline_versions', {
  id: text('id').primaryKey(),
  versionNumber: integer('version_number').notNull(),
  isActive: integer('is_active').notNull().default(0),
  description: text('description'),
  config: text('config').notNull(),
  checksum: text('checksum').notNull(),
  createdAt: text('created_at').notNull(),
});

export const promptsTable = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  stepId: text('step_id').notNull(),
  modelId: text('model_id').references(() => modelsTable.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const systemSettingsTable = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const behaviourVocabularyTable = sqliteTable('behaviour_vocabulary', {
  id: text('id').primaryKey(),
  word: text('word').notNull().unique(),
  lemma: text('lemma'),
  anchor: text('anchor').notNull(),
  domain: text('domain').notNull(),
  baseWeight: integer('base_weight').notNull().default(2),
  polarity: text('polarity').notNull().default('positive'),
  modelVersion: integer('model_version').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const behaviourRulesTable = sqliteTable('behaviour_rules', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),
  anchor: text('anchor').notNull(),
  domain: text('domain').notNull(),
  bonusPoints: integer('bonus_points').notNull().default(1),
  explanationTemplate: text('explanation_template').notNull(),
  modelVersion: integer('model_version').notNull().default(1),
});

export const behaviourModelVersionsTable = sqliteTable('behaviour_model_versions', {
  id: text('id').primaryKey(),
  versionNumber: integer('version_number').notNull(),
  isActive: integer('is_active').notNull().default(0),
  compiledSnapshot: text('compiled_snapshot').notNull(),
  checksum: text('checksum').notNull(),
  createdAt: text('created_at').notNull(),
});

