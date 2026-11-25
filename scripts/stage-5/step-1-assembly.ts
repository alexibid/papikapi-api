import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AssemblyPlanStore } from '../shared/common/assembly-plan-store.js';
import { ManifestManager } from '../shared/common/manifest-manager.js';
import { PipelineConfigLoader } from '../shared/common/pipeline-config.js';
import { ProgressHub } from '../shared/common/progress-hub.js';
import { WorkspacePaths } from '../shared/common/workspace-paths.js';
import { AssemblyBuilder } from './assembly-builder.js';
import { FaceColourAssigner } from './face-colour-assigner.js';
import { GlbColourReader } from './glb-colour-reader.js';
import type {
  AssemblySource,
  AssemblySourcePiece,
  AssemblyStepDefinition,
  Stage5Response,
} from './interfaces/assembly.interface.js';

const MM_PER_METRE = 1000;
const DB_ASSEMBLY_TARGET = 'models.assembly_plan';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringField(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string';
}

function isNumberField(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'number';
}

function isAssemblySourcePiece(value: unknown): value is AssemblySourcePiece {
  return (
    isRecord(value) &&
    isNumberField(value, 'number') &&
    Array.isArray(value.faceIds) &&
    Array.isArray(value.faces) &&
    isNumberField(value, 'areaMm2')
  );
}

function isAssemblySource(value: unknown): value is AssemblySource {
  return (
    isRecord(value) &&
    Array.isArray(value.dimensionsMm) &&
    isNumberField(value, 'meshScale') &&
    isRecord(value.mesh) &&
    Array.isArray(value.mesh.vertices) &&
    Array.isArray(value.mesh.faces) &&
    Array.isArray(value.pieces) &&
    value.pieces.every(isAssemblySourcePiece)
  );
}

function isAssemblyStepDefinition(value: unknown): value is AssemblyStepDefinition {
  if (!isRecord(value)) return false;
  if (!isStringField(value, 'id') || !isStringField(value, 'stage_dir')) return false;
  if (!isRecord(value.inputs) || !isRecord(value.outputs)) return false;
  if (!isRecord(value.parameters) || !isRecord(value.messages) || !isRecord(value.manifest_contract)) {
    return false;
  }
  const { inputs, outputs, parameters, messages, manifest_contract } = value;
  return (
    isStringField(inputs, 'stage_dir') &&
    isStringField(inputs, 'net_resource') &&
    isStringField(inputs, 'texture_stage_dir') &&
    isStringField(inputs, 'texture_model') &&
    isStringField(outputs, 'assembly_resource') &&
    isStringField(outputs, 'assembly_public') &&
    isStringField(outputs, 'public_url_pattern') &&
    isStringField(outputs, 'manifest') &&
    isNumberField(parameters, 'hinge_tolerance_mm') &&
    isNumberField(parameters, 'tray_gap_mm') &&
    isNumberField(parameters, 'tray_row_width_mm') &&
    isStringField(messages, 'start') &&
    isStringField(messages, 'completed') &&
    isStringField(manifest_contract, 'status') &&
    isStringField(manifest_contract, 'costNote')
  );
}

export class AssemblyGenerator {
  private static readonly stepId = 's5-step-1';

  public static async execute(modelName: string): Promise<Stage5Response> {
    const step = this.loadStep();
    const resourceDir = WorkspacePaths.resourcePath(modelName);
    const startMessage = step.messages.start.replace('{model}', modelName);
    console.log(`\n  \x1b[35m${startMessage}\x1b[0m`);
    ProgressHub.report(modelName, this.stepId, startMessage);

    const start = Date.now();
    const rawSource = this.readSource(join(resourceDir, step.inputs.stage_dir, step.inputs.net_resource));
    const source: AssemblySource = {
      ...rawSource,
      pieces: rawSource.pieces.filter((piece) => !piece.isPlinth),
    };
    const texturePath = this.resolveTexturePath(resourceDir, step);
    const triangles = await GlbColourReader.read(texturePath, source.meshScale * MM_PER_METRE);
    const geometries = AssemblyBuilder.faceGeometries(source);
    const colours = FaceColourAssigner.assign(geometries, triangles);
    const document = AssemblyBuilder.compose(source, geometries, colours, step.parameters);

    AssemblyPlanStore.save(modelName, JSON.stringify(document));
    const seconds = Math.round(((Date.now() - start) / 1000) * 100) / 100;

    const completedMessage = step.messages.completed
      .replace('{model}', modelName)
      .replace('{pieces}', String(document.checks.pieces))
      .replace('{hinges}', String(document.checks.hinges))
      .replace('{duration}', String(seconds));
    console.log(`  \x1b[32m${completedMessage}\x1b[0m\n`);
    ProgressHub.report(modelName, this.stepId, completedMessage);

    ManifestManager.writeStepResult(modelName, this.stepId, {
      status: step.manifest_contract.status,
      seconds,
      costUsd: 0.0,
      costNote: step.manifest_contract.costNote,
      metrics: { ...document.checks },
      data: {
        source: join(step.inputs.stage_dir, step.inputs.net_resource),
        assemblyTarget: DB_ASSEMBLY_TARGET,
      },
    });

    return { name: modelName, outputPath: DB_ASSEMBLY_TARGET, seconds };
  }

  private static loadStep(): AssemblyStepDefinition {
    const step: unknown = PipelineConfigLoader.getStep(this.stepId);
    if (!isAssemblyStepDefinition(step)) {
      throw new Error(`Invalid pipeline definition for step '${this.stepId}'`);
    }
    return step;
  }

  private static readSource(netPath: string): AssemblySource {
    const parsed: unknown = JSON.parse(readFileSync(netPath, 'utf8'));
    if (!isAssemblySource(parsed)) {
      throw new Error(`Invalid unfolded net source at '${netPath}'`);
    }
    return parsed;
  }

  private static resolveTexturePath(resourceDir: string, step: AssemblyStepDefinition): string {
    const candidates = [
      join(resourceDir, step.inputs.texture_stage_dir, step.inputs.texture_model),
      join(resourceDir, step.inputs.texture_stage_dir, 'step-4-texturize.glb'),
      join(resourceDir, 'stage-3', 'step-5-plinth.glb'),
      join(resourceDir, 'stage-3', 'step-3-texturize.glb'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
  }
}
