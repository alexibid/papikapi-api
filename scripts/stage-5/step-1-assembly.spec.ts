import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PapikapiDatabase } from '../shared/common/papikapi-database.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import { GlbColourReader } from './glb-colour-reader.js';
import { AssemblyGenerator } from './step-1-assembly.js';
import { STEP_1_ASSEMBLY_MOCKS } from './step-1-assembly.mock.js';

const ALL_MODELS = [
  STEP_1_ASSEMBLY_MOCKS.modelId,
  STEP_1_ASSEMBLY_MOCKS.multiPieceModelId,
  STEP_1_ASSEMBLY_MOCKS.missingNetModelId,
];

function isAssemblyRow(value: unknown): value is { readonly assembly_plan: string | null } {
  return typeof value === 'object' && value !== null && 'assembly_plan' in value;
}

function isParsedAssembly(value: unknown): value is {
  readonly dimensionsMm: readonly unknown[];
  readonly pieces: readonly unknown[];
  readonly checks: { readonly pieces: number };
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dimensionsMm' in value &&
    Array.isArray(value.dimensionsMm) &&
    'pieces' in value &&
    Array.isArray(value.pieces) &&
    'checks' in value &&
    typeof value.checks === 'object' &&
    value.checks !== null &&
    'pieces' in value.checks
  );
}

function seedModelRow(modelId: string, assemblyPlan: string | null): void {
  PapikapiDatabase.connection()
    .prepare(
      'INSERT OR REPLACE INTO models (id, subject, status, assembly_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      modelId,
      modelId,
      'DONE',
      assemblyPlan,
      STEP_1_ASSEMBLY_MOCKS.timestamp,
      STEP_1_ASSEMBLY_MOCKS.timestamp,
    );
}

function seedStageInputs(modelId: string, netDocument: unknown): void {
  const stage4Dir = join(WorkspacePaths.resourcePath(modelId), 'stage-4');
  const stage3Dir = join(WorkspacePaths.resourcePath(modelId), 'stage-3');
  mkdirSync(stage4Dir, { recursive: true });
  mkdirSync(stage3Dir, { recursive: true });
  writeFileSync(join(stage4Dir, 'step-1-net.json'), JSON.stringify(netDocument));
  writeFileSync(join(stage3Dir, 'step-4-texturize.glb'), 'glb');
}

function readDbAssemblyPlan(modelId: string): string | null {
  const row: unknown = PapikapiDatabase.connection()
    .prepare('SELECT assembly_plan FROM models WHERE id = ?')
    .get(modelId);
  if (!isAssemblyRow(row)) {
    return null;
  }
  return row.assembly_plan;
}

describe('AssemblyGenerator.execute', () => {
  let readSpy: ReturnType<typeof vi.spyOn>;
  let manifestSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    readSpy = vi.spyOn(GlbColourReader, 'read').mockResolvedValue(STEP_1_ASSEMBLY_MOCKS.colouredTriangles);
    manifestSpy = vi.spyOn(ManifestManager, 'writeStepResult').mockReturnValue(STEP_1_ASSEMBLY_MOCKS.manifestStub);
  });

  afterEach(() => {
    readSpy.mockRestore();
    manifestSpy.mockRestore();
    const db = PapikapiDatabase.connection();
    ALL_MODELS.forEach((model) => {
      db.prepare('DELETE FROM models WHERE id = ?').run(model);
      rmSync(WorkspacePaths.resourcePath(model), { recursive: true, force: true });
      rmSync(WorkspacePaths.modelPath(model), { recursive: true, force: true });
    });
  });

  it('should persist the generated assembly plan into models.assembly_plan and never write assembly.json or step-1-assembly.json to disk', async () => {
    const model = STEP_1_ASSEMBLY_MOCKS.modelId;
    seedModelRow(model, null);
    seedStageInputs(model, STEP_1_ASSEMBLY_MOCKS.singlePieceNet);

    await AssemblyGenerator.execute(model);

    const saved = readDbAssemblyPlan(model);
    expect(typeof saved).toBe('string');
    const parsed: unknown = JSON.parse(saved ?? 'null');
    expect(isParsedAssembly(parsed)).toBe(true);
    if (isParsedAssembly(parsed)) {
      expect(parsed.pieces.length).toBe(1);
    }
    expect(existsSync(join(WorkspacePaths.resourcePath(model), 'stage-5', 'step-1-assembly.json'))).toBe(false);
    expect(existsSync(join(WorkspacePaths.modelPath(model), 'assembly.json'))).toBe(false);
  });

  it('should persist all pieces for a multi-piece figure into models.assembly_plan without writing disk assembly files', async () => {
    const model = STEP_1_ASSEMBLY_MOCKS.multiPieceModelId;
    seedModelRow(model, null);
    seedStageInputs(model, STEP_1_ASSEMBLY_MOCKS.multiPieceNet);

    await AssemblyGenerator.execute(model);

    const saved = readDbAssemblyPlan(model);
    expect(typeof saved).toBe('string');
    const parsed: unknown = JSON.parse(saved ?? 'null');
    expect(isParsedAssembly(parsed)).toBe(true);
    if (isParsedAssembly(parsed)) {
      expect(parsed.pieces.length).toBe(2);
    }
    expect(existsSync(join(WorkspacePaths.resourcePath(model), 'stage-5', 'step-1-assembly.json'))).toBe(false);
    expect(existsSync(join(WorkspacePaths.modelPath(model), 'assembly.json'))).toBe(false);
  });

  it('should overwrite a stale models.assembly_plan in SQLite without writing disk files', async () => {
    const model = STEP_1_ASSEMBLY_MOCKS.modelId;
    seedModelRow(model, STEP_1_ASSEMBLY_MOCKS.stalePlan);
    seedStageInputs(model, STEP_1_ASSEMBLY_MOCKS.singlePieceNet);

    await AssemblyGenerator.execute(model);

    const saved = readDbAssemblyPlan(model);
    expect(saved).not.toBeNull();
    expect(saved).not.toBe(STEP_1_ASSEMBLY_MOCKS.stalePlan);
    expect(existsSync(join(WorkspacePaths.resourcePath(model), 'stage-5', 'step-1-assembly.json'))).toBe(false);
    expect(existsSync(join(WorkspacePaths.modelPath(model), 'assembly.json'))).toBe(false);
  });

  it('should throw when stage-4/step-1-net.json is missing and leave models.assembly_plan null with no files written', async () => {
    const model = STEP_1_ASSEMBLY_MOCKS.missingNetModelId;
    seedModelRow(model, null);

    await expect(AssemblyGenerator.execute(model)).rejects.toThrow();

    expect(readDbAssemblyPlan(model)).toBeNull();
    expect(existsSync(join(WorkspacePaths.resourcePath(model), 'stage-5', 'step-1-assembly.json'))).toBe(false);
    expect(existsSync(join(WorkspacePaths.modelPath(model), 'assembly.json'))).toBe(false);
  });
});
