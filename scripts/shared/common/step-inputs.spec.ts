import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PapikapiDatabase } from './papikapi-database.js';
import { PipelineConfigLoader } from './pipeline-config.js';
import { StepInputs } from './step-inputs.js';
import { STEP_INPUTS_MOCKS } from './step-inputs.mock.js';
import { WorkspacePaths } from './workspace-paths.js';

const ALL_MODELS = [
  ...STEP_INPUTS_MOCKS.models,
  STEP_INPUTS_MOCKS.emptyModel,
  STEP_INPUTS_MOCKS.missingModel,
];

const resourceFile = (model: string, relativePath: string): string =>
  join(WorkspacePaths.resourcePath(model), relativePath);

const publicFile = (model: string, fileName: string): string =>
  join(WorkspacePaths.modelPath(model), fileName);

function writeFile(filePath: string, content: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

function seedStage5Inputs(model: string): void {
  writeFile(resourceFile(model, 'stage-4/step-1-net.json'), STEP_INPUTS_MOCKS.netPayload);
  writeFile(resourceFile(model, 'stage-3/step-4-texturize.glb'), 'glb');
}

function seedStage5DiskFiles(model: string): void {
  STEP_INPUTS_MOCKS.s5ResourceOutputs.forEach((file) =>
    writeFile(resourceFile(model, file), STEP_INPUTS_MOCKS.assemblyPayload),
  );
  writeFile(publicFile(model, 'assembly.json'), STEP_INPUTS_MOCKS.assemblyPayload);
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
      STEP_INPUTS_MOCKS.timestamp,
      STEP_INPUTS_MOCKS.timestamp,
    );
}

describe('StepInputs', () => {
  const s5Step = PipelineConfigLoader.getStep('s5-step-1');
  const s4Step = PipelineConfigLoader.getStep('s4-step-1');

  afterEach(() => {
    const conn = PapikapiDatabase.connection();
    ALL_MODELS.forEach((model) => {
      conn.prepare('DELETE FROM models WHERE id = ?').run(model);
      rmSync(WorkspacePaths.resourcePath(model), { recursive: true, force: true });
      rmSync(WorkspacePaths.modelPath(model), { recursive: true, force: true });
    });
  });

  it('should return outputsPresent as false for s5-step-1 when models.assembly_plan is null or missing in SQLite even if step-1-assembly.json exists on disk', () => {
    const model = STEP_INPUTS_MOCKS.models[0];
    seedStage5Inputs(model);
    seedStage5DiskFiles(model);
    seedModelRow(model, null);

    expect(StepInputs.outputsPresent(model, s5Step)).toBe(false);
    expect(StepInputs.skipReasons(model, s5Step, STEP_INPUTS_MOCKS.defaultFlags)).toEqual([]);
  });

  it('should return outputsPresent as true and skip s5-step-1 when models.assembly_plan is populated in SQLite even with zero stage-5 or public assembly files on disk', () => {
    STEP_INPUTS_MOCKS.models.forEach((model) => {
      seedStage5Inputs(model);
      seedModelRow(model, STEP_INPUTS_MOCKS.assemblyPayload);

      expect(StepInputs.outputsPresent(model, s5Step)).toBe(true);
      expect(StepInputs.skipReasons(model, s5Step, STEP_INPUTS_MOCKS.defaultFlags).length).toBeGreaterThan(0);
    });
  });

  it('should return outputsPresent as false when models.assembly_plan is missing or empty string in SQLite', () => {
    const missingRowModel = STEP_INPUTS_MOCKS.models[0];
    seedStage5Inputs(missingRowModel);
    seedStage5DiskFiles(missingRowModel);
    expect(StepInputs.outputsPresent(missingRowModel, s5Step)).toBe(false);

    const emptyPlanModel = STEP_INPUTS_MOCKS.models[1];
    seedStage5Inputs(emptyPlanModel);
    seedModelRow(emptyPlanModel, '');
    expect(StepInputs.outputsPresent(emptyPlanModel, s5Step)).toBe(false);
  });

  it('should return a skip reason when s5-step-1 stage-4 inputs are missing regardless of database assembly_plan', () => {
    const model = STEP_INPUTS_MOCKS.missingModel;
    seedModelRow(model, STEP_INPUTS_MOCKS.assemblyPayload);

    expect(StepInputs.skipReasons(model, s5Step, STEP_INPUTS_MOCKS.defaultFlags).length).toBeGreaterThan(0);
  });

  it('should not skip s5-step-1 when force flag is enabled even if models.assembly_plan is populated in SQLite', () => {
    const model = STEP_INPUTS_MOCKS.models[0];
    seedStage5Inputs(model);
    seedModelRow(model, STEP_INPUTS_MOCKS.assemblyPayload);

    expect(StepInputs.skipReasons(model, s5Step, STEP_INPUTS_MOCKS.forceFlags)).toEqual([]);
  });

  it('should not skip s4-step-1 when stage-3 plinth exists and stage-4 outputs are missing', () => {
    const model = STEP_INPUTS_MOCKS.models[0];
    writeFile(resourceFile(model, 'stage-3/step-5-plinth.json'), '{}');

    expect(StepInputs.outputsPresent(model, s4Step)).toBe(false);
    expect(StepInputs.skipReasons(model, s4Step, STEP_INPUTS_MOCKS.defaultFlags)).toEqual([]);
  });

  it('should return outputsPresent as false for empty directories with no database row', () => {
    mkdirSync(WorkspacePaths.resourcePath(STEP_INPUTS_MOCKS.emptyModel), { recursive: true });
    mkdirSync(WorkspacePaths.modelPath(STEP_INPUTS_MOCKS.emptyModel), { recursive: true });

    expect(StepInputs.outputsPresent(STEP_INPUTS_MOCKS.emptyModel, s5Step)).toBe(false);
  });
});
