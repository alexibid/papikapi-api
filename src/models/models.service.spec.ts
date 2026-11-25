import { NotFoundException } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiConfigService } from '../config/config.service.js';
import * as schema from '../database/schema.js';
import { PipelineService } from '../pipeline/pipeline.service.js';
import { ModelPreviewsReader } from './model-previews.js';
import { MODELS_SERVICE_MOCKS } from './models.service.mock.js';
import { ModelsService } from './models.service.js';

const MODELS_DDL = `
  CREATE TABLE models (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    display_name_pt TEXT,
    display_name_en TEXT,
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
`;

function writeDiskAssemblyFiles(resourcesDir: string, modelsDir: string, modelId: string): void {
  const stage5Dir = join(resourcesDir, modelId, 'stage-5');
  const publicDir = join(modelsDir, modelId);
  mkdirSync(stage5Dir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(stage5Dir, 'step-1-assembly.json'), MODELS_SERVICE_MOCKS.diskFallbackPayload);
  writeFileSync(join(publicDir, 'assembly.json'), MODELS_SERVICE_MOCKS.diskFallbackPayload);
}

describe('ModelsService.getAssemblyPlan', () => {
  let sqlite: Database.Database;
  let sandbox: string;
  let resourcesDir: string;
  let modelsDir: string;
  let service: ModelsService;
  const previousEnv = {
    resources: process.env['PAPIKAPI_RESOURCES_DIR'],
    models: process.env['PAPIKAPI_MODELS_DIR'],
    db: process.env['PAPIKAPI_DATABASE_PATH'],
  };

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'papikapi-models-service-'));
    resourcesDir = join(sandbox, 'resources');
    modelsDir = join(sandbox, 'public', 'models');
    mkdirSync(resourcesDir, { recursive: true });
    mkdirSync(modelsDir, { recursive: true });

    process.env['PAPIKAPI_RESOURCES_DIR'] = resourcesDir;
    process.env['PAPIKAPI_MODELS_DIR'] = modelsDir;
    process.env['PAPIKAPI_DATABASE_PATH'] = join(resourcesDir, 'papikapi.db');

    sqlite = new Database(':memory:');
    sqlite.exec(MODELS_DDL);
    const db = drizzle(sqlite, { schema });
    const config = new ApiConfigService();
    const pipeline = new PipelineService(db);
    const previews = new ModelPreviewsReader(config, pipeline);
    service = new ModelsService(config, pipeline, db, previews);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(sandbox, { recursive: true, force: true });
    if (previousEnv.resources === undefined) delete process.env['PAPIKAPI_RESOURCES_DIR'];
    else process.env['PAPIKAPI_RESOURCES_DIR'] = previousEnv.resources;
    if (previousEnv.models === undefined) delete process.env['PAPIKAPI_MODELS_DIR'];
    else process.env['PAPIKAPI_MODELS_DIR'] = previousEnv.models;
    if (previousEnv.db === undefined) delete process.env['PAPIKAPI_DATABASE_PATH'];
    else process.env['PAPIKAPI_DATABASE_PATH'] = previousEnv.db;
  });

  function insertModel(id: string, assemblyPlan: string | null): void {
    sqlite
      .prepare(
        'INSERT INTO models (id, subject, status, assembly_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, id, 'DONE', assemblyPlan, MODELS_SERVICE_MOCKS.timestamp, MODELS_SERVICE_MOCKS.timestamp);
  }

  it('should read the assembly plan exclusively from the models.assembly_plan column in the database', () => {
    insertModel(MODELS_SERVICE_MOCKS.modelId, MODELS_SERVICE_MOCKS.validAssemblyPlan);
    writeDiskAssemblyFiles(resourcesDir, modelsDir, MODELS_SERVICE_MOCKS.modelId);

    const result = service.getAssemblyPlan(MODELS_SERVICE_MOCKS.modelId);

    expect(result).toBe(MODELS_SERVICE_MOCKS.validAssemblyPlan);
    expect(result).not.toBe(MODELS_SERVICE_MOCKS.diskFallbackPayload);
  });

  it('should throw NotFoundException with no filesystem fallback when models.assembly_plan is null even if disk files exist', () => {
    insertModel(MODELS_SERVICE_MOCKS.modelId, null);
    writeDiskAssemblyFiles(resourcesDir, modelsDir, MODELS_SERVICE_MOCKS.modelId);

    expect(() => service.getAssemblyPlan(MODELS_SERVICE_MOCKS.modelId)).toThrow(NotFoundException);
  });

  it('should throw NotFoundException when models.assembly_plan is empty or whitespace even if disk files exist', () => {
    insertModel(MODELS_SERVICE_MOCKS.emptyPlanModelId, '');
    insertModel(MODELS_SERVICE_MOCKS.whitespacePlanModelId, '   ');
    writeDiskAssemblyFiles(resourcesDir, modelsDir, MODELS_SERVICE_MOCKS.emptyPlanModelId);
    writeDiskAssemblyFiles(resourcesDir, modelsDir, MODELS_SERVICE_MOCKS.whitespacePlanModelId);

    expect(() => service.getAssemblyPlan(MODELS_SERVICE_MOCKS.emptyPlanModelId)).toThrow(NotFoundException);
    expect(() => service.getAssemblyPlan(MODELS_SERVICE_MOCKS.whitespacePlanModelId)).toThrow(NotFoundException);
  });

  it('should throw NotFoundException when the model row does not exist in the database even if disk files exist', () => {
    writeDiskAssemblyFiles(resourcesDir, modelsDir, MODELS_SERVICE_MOCKS.diskOnlyModelId);

    expect(() => service.getAssemblyPlan(MODELS_SERVICE_MOCKS.diskOnlyModelId)).toThrow(NotFoundException);
  });

  it('should clean uppercase or padded model names and return each matching database assembly_plan independently', () => {
    insertModel(MODELS_SERVICE_MOCKS.modelId, MODELS_SERVICE_MOCKS.validAssemblyPlan);
    insertModel(MODELS_SERVICE_MOCKS.secondaryModelId, MODELS_SERVICE_MOCKS.secondaryAssemblyPlan);

    expect(service.getAssemblyPlan(`  ${MODELS_SERVICE_MOCKS.modelId.toUpperCase()}  `)).toBe(
      MODELS_SERVICE_MOCKS.validAssemblyPlan,
    );
    expect(service.getAssemblyPlan(MODELS_SERVICE_MOCKS.secondaryModelId)).toBe(
      MODELS_SERVICE_MOCKS.secondaryAssemblyPlan,
    );
  });
});
