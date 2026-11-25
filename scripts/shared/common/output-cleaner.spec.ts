import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OutputCleaner } from './output-cleaner.js';
import { OUTPUT_CLEANER_MOCKS } from './output-cleaner.mock.js';
import { PapikapiDatabase } from './papikapi-database.js';
import { WorkspacePaths } from './workspace-paths.js';

const BATCH_MODELS = Array.from(
  { length: OUTPUT_CLEANER_MOCKS.batchModelCount },
  (_, index) => `${OUTPUT_CLEANER_MOCKS.batchModelPrefix}${String(index + 1).padStart(2, '0')}`,
);

const CREATED_MODELS = [
  OUTPUT_CLEANER_MOCKS.primaryModel,
  OUTPUT_CLEANER_MOCKS.secondaryModel,
  OUTPUT_CLEANER_MOCKS.emptyDirModel,
  OUTPUT_CLEANER_MOCKS.missingDirModel,
  ...BATCH_MODELS,
];

const resourceFile = (model: string, relativePath: string): string =>
  join(WorkspacePaths.resourcePath(model), relativePath);

const publicFile = (model: string, fileName: string): string =>
  join(WorkspacePaths.modelPath(model), fileName);

function isModelCountRow(value: unknown): value is { readonly total: number; readonly populated: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'total' in value &&
    typeof value.total === 'number' &&
    'populated' in value &&
    typeof value.populated === 'number'
  );
}

function listDirectories(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

function seedPublishedFigure(model: string): void {
  OUTPUT_CLEANER_MOCKS.preservedResourceFiles.forEach((file) =>
    writeFile(resourceFile(model, file), OUTPUT_CLEANER_MOCKS.netPayload),
  );
  writeFile(resourceFile(model, 'stage-5/step-1-assembly.json'), OUTPUT_CLEANER_MOCKS.assemblyPayload);
  OUTPUT_CLEANER_MOCKS.mediaFiles.forEach((file) => writeFile(publicFile(model, file), 'media'));
  writeFile(publicFile(model, 'assembly.json'), OUTPUT_CLEANER_MOCKS.assemblyPayload);
}

describe('OutputCleaner', () => {
  afterEach(() => {
    const db = PapikapiDatabase.connection();
    CREATED_MODELS.forEach((model) => {
      db.prepare('DELETE FROM models WHERE id = ?').run(model);
      rmSync(WorkspacePaths.resourcePath(model), { recursive: true, force: true });
      rmSync(WorkspacePaths.modelPath(model), { recursive: true, force: true });
    });
  });

  it('should delete both public/models/<id>/assembly.json and resources/<id>/stage-5/step-1-assembly.json while preserving stage-4/step-1-net.json and media files', () => {
    const model = OUTPUT_CLEANER_MOCKS.primaryModel;
    seedPublishedFigure(model);

    OutputCleaner.purgeNonMediaFiles(model);

    expect(existsSync(publicFile(model, 'assembly.json'))).toBe(false);
    expect(existsSync(resourceFile(model, 'stage-5/step-1-assembly.json'))).toBe(false);
    expect(existsSync(resourceFile(model, 'stage-4/step-1-net.json'))).toBe(true);
    expect(readFileSync(resourceFile(model, 'stage-4/step-1-net.json'), 'utf8')).toBe(
      OUTPUT_CLEANER_MOCKS.netPayload,
    );
    OUTPUT_CLEANER_MOCKS.mediaFiles.forEach((file) => {
      expect(existsSync(publicFile(model, file))).toBe(true);
    });
  });

  it('should delete assembly.json and step-1-assembly.json from disk across multiple models', () => {
    [OUTPUT_CLEANER_MOCKS.primaryModel, OUTPUT_CLEANER_MOCKS.secondaryModel].forEach((model) => {
      seedPublishedFigure(model);
      OutputCleaner.purgeNonMediaFiles(model);
      expect(existsSync(publicFile(model, 'assembly.json'))).toBe(false);
      expect(existsSync(resourceFile(model, 'stage-5/step-1-assembly.json'))).toBe(false);
      expect(existsSync(resourceFile(model, 'stage-4/step-1-net.json'))).toBe(true);
    });
  });

  it('should purge assembly.json and step-1-assembly.json across a batch of 56 models in the sandbox while preserving all 56 assembly_plan rows in SQLite', () => {
    const db = PapikapiDatabase.connection();
    const insert = db.prepare(
      'INSERT OR REPLACE INTO models (id, subject, status, assembly_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    BATCH_MODELS.forEach((model) => {
      insert.run(
        model,
        model,
        'DONE',
        OUTPUT_CLEANER_MOCKS.assemblyPayload,
        OUTPUT_CLEANER_MOCKS.timestamp,
        OUTPUT_CLEANER_MOCKS.timestamp,
      );
      seedPublishedFigure(model);
    });

    BATCH_MODELS.forEach((model) => OutputCleaner.purgeNonMediaFiles(model));

    const row: unknown = db
      .prepare(
        "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN assembly_plan IS NOT NULL AND TRIM(assembly_plan) != '' THEN 1 ELSE 0 END), 0) AS populated FROM models WHERE id LIKE ?",
      )
      .get(`${OUTPUT_CLEANER_MOCKS.batchModelPrefix}%`);

    expect(isModelCountRow(row)).toBe(true);
    if (isModelCountRow(row)) {
      expect(row.total).toBe(OUTPUT_CLEANER_MOCKS.batchModelCount);
      expect(row.populated).toBe(OUTPUT_CLEANER_MOCKS.batchModelCount);
    }

    const remainingPublicAssembly = BATCH_MODELS.filter((model) => existsSync(publicFile(model, 'assembly.json')));
    const remainingStage5Assembly = BATCH_MODELS.filter((model) =>
      existsSync(resourceFile(model, 'stage-5/step-1-assembly.json')),
    );
    expect(remainingPublicAssembly).toEqual([]);
    expect(remainingStage5Assembly).toEqual([]);
    BATCH_MODELS.forEach((model) => {
      expect(existsSync(resourceFile(model, 'stage-4/step-1-net.json'))).toBe(true);
      expect(existsSync(publicFile(model, 'model.glb'))).toBe(true);
    });
  });

  it('should ensure all 56 existing models have their assembly plan populated in models.assembly_plan of papikapi.db and all public/models/*/assembly.json and resources/*/stage-5/step-1-assembly.json files are deleted from disk', () => {
    const realDbPath = join(WorkspacePaths.appRoot, 'resources', 'papikapi.db');
    if (!existsSync(realDbPath)) {
      return;
    }

    const db = new Database(realDbPath, { readonly: true });
    try {
      const row: unknown = db
        .prepare(
          "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN assembly_plan IS NOT NULL AND TRIM(assembly_plan) != '' THEN 1 ELSE 0 END), 0) AS populated FROM models",
        )
        .get();

      expect(isModelCountRow(row)).toBe(true);
      if (isModelCountRow(row)) {
        expect(row.total).toBe(OUTPUT_CLEANER_MOCKS.batchModelCount);
        expect(row.populated).toBe(OUTPUT_CLEANER_MOCKS.batchModelCount);
      }
    } finally {
      db.close();
    }

    const realPublicDir = join(WorkspacePaths.appRoot, 'public', 'models');
    const realResourcesDir = join(WorkspacePaths.appRoot, 'resources');
    const leftoverPublicAssembly = listDirectories(realPublicDir).filter((id) =>
      existsSync(join(realPublicDir, id, 'assembly.json')),
    );
    const leftoverStage5Assembly = listDirectories(realResourcesDir).filter((id) =>
      existsSync(join(realResourcesDir, id, 'stage-5', 'step-1-assembly.json')),
    );

    expect(leftoverPublicAssembly).toEqual([]);
    expect(leftoverStage5Assembly).toEqual([]);
  });

  it('should delete resources/<id>/stage-5/step-1-assembly.json even when public/models/<id>/assembly.json is already absent', () => {
    const model = OUTPUT_CLEANER_MOCKS.primaryModel;
    writeFile(resourceFile(model, 'stage-5/step-1-assembly.json'), OUTPUT_CLEANER_MOCKS.assemblyPayload);
    writeFile(resourceFile(model, 'stage-4/step-1-net.json'), OUTPUT_CLEANER_MOCKS.netPayload);

    OutputCleaner.purgeNonMediaFiles(model);

    expect(existsSync(resourceFile(model, 'stage-5/step-1-assembly.json'))).toBe(false);
    expect(existsSync(resourceFile(model, 'stage-4/step-1-net.json'))).toBe(true);
  });

  it('should handle empty and missing model directories without throwing', () => {
    mkdirSync(WorkspacePaths.modelPath(OUTPUT_CLEANER_MOCKS.emptyDirModel), { recursive: true });
    mkdirSync(WorkspacePaths.resourcePath(OUTPUT_CLEANER_MOCKS.emptyDirModel), { recursive: true });

    expect(() => OutputCleaner.purgeNonMediaFiles(OUTPUT_CLEANER_MOCKS.emptyDirModel)).not.toThrow();
    expect(() => OutputCleaner.purgeNonMediaFiles(OUTPUT_CLEANER_MOCKS.missingDirModel)).not.toThrow();
  });
});
