import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { DRIZZLE_DB } from '../../database/database.provider.js';
import * as schema from '../../database/schema.js';
import { modelStagesTable, modelsTable, promptsTable, stepRunsTable } from '../../database/schema.js';
import type { DisplayNames, LatestStepRow, ModelRow, StepRunRow } from '../domain/manifest.types.js';

const FIGURE_PROMPT_STEP = 's1-step-1';

export interface StoredFigure {
  readonly model: ModelRow;
  readonly steps: readonly LatestStepRow[];
  readonly runs: readonly StepRunRow[];
}

/** Reads the figures, their latest step results and every recorded run from the database, all in one pass. */
@Injectable()
export class ManifestStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: BetterSQLite3Database<typeof schema>) {}

  public all(): readonly StoredFigure[] {
    const prompts = this.promptsByModel();
    const steps = this.groupByModel(this.db.select().from(modelStagesTable).all().map(latestStepOf));
    const runs = this.groupByModel(this.db.select().from(stepRunsTable).all().map(runOf));
    return this.db.select().from(modelsTable).all().map((row) => ({
      model: modelOf(row, prompts.get(row.id) ?? null),
      steps: steps.get(row.id) ?? [],
      runs: runs.get(row.id) ?? [],
    }));
  }

  public one(id: string): StoredFigure | null {
    const row = this.db.select().from(modelsTable).where(eq(modelsTable.id, id)).get();
    if (!row) return null;
    const prompt = this.db.select().from(promptsTable).where(eq(promptsTable.modelId, id)).all()
      .find((entry) => entry.stepId === FIGURE_PROMPT_STEP);
    return {
      model: modelOf(row, prompt?.content ?? null),
      steps: this.db.select().from(modelStagesTable).where(eq(modelStagesTable.modelId, id)).all().map(latestStepOf),
      runs: this.db.select().from(stepRunsTable).where(eq(stepRunsTable.modelId, id)).all().map(runOf),
    };
  }

  private promptsByModel(): ReadonlyMap<string, string> {
    const rows = this.db.select().from(promptsTable).where(eq(promptsTable.stepId, FIGURE_PROMPT_STEP)).all();
    return new Map(rows.flatMap((row) => (row.modelId ? [[row.modelId, row.content] as const] : [])));
  }

  private groupByModel<T extends { readonly modelId: string }>(rows: readonly T[]): ReadonlyMap<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      grouped.set(row.modelId, [...(grouped.get(row.modelId) ?? []), row]);
    }
    return grouped;
  }
}

function modelOf(row: typeof modelsTable.$inferSelect, prompt: string | null): ModelRow {
  return {
    id: row.id,
    subject: row.subject,
    name: namesOf(row),
    prompt,
    fluxPrompt: row.fluxPrompt,
    chosenPick: row.chosenPick,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function namesOf(row: typeof modelsTable.$inferSelect): DisplayNames {
  const words = row.subject.split('-').filter(Boolean).join(' ');
  const fallback = words.charAt(0).toUpperCase() + words.slice(1);
  return { pt: row.displayNamePt ?? fallback, en: row.displayNameEn ?? fallback };
}

function latestStepOf(row: typeof modelStagesTable.$inferSelect): LatestStepRow {
  return {
    modelId: row.modelId,
    stageId: row.stageId,
    status: row.status,
    seconds: row.seconds ?? 0,
    costUsd: row.costUsd ?? 0,
    costNote: row.costNote,
    finishedAt: row.timestamp,
    metrics: parsed(row.metrics),
    data: parsed(row.data),
  };
}

function runOf(row: typeof stepRunsTable.$inferSelect): StepRunRow {
  return {
    modelId: row.modelId,
    stageId: row.stageId,
    status: row.status,
    seconds: row.seconds,
    costUsd: row.costUsd,
    costNote: row.costNote,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    version: row.appVersion,
  };
}

function parsed(json: string | null): Readonly<Record<string, unknown>> | null {
  if (!json) return null;
  const value: unknown = JSON.parse(json);
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
