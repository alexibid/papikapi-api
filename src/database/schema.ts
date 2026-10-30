import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const modelsTable = sqliteTable('models', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull(),
  prompt: text('prompt'),
  fluxPrompt: text('flux_prompt'),
  status: text('status').notNull().default('DONE'),
  chosenPick: integer('chosen_pick'),
  totalSeconds: real('total_seconds').default(0),
  totalCostUsd: real('total_cost_usd').default(0),
  primaryMeshPath: text('primary_mesh_path'),
  sheetPath: text('sheet_path'),
  previewPath: text('preview_path'),
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
