import { Inject, Injectable } from '@nestjs/common';
import { and, avg, count, desc, eq, gte, like, lte, max, min, sum } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';
import { DRIZZLE_DB } from '../../database/database.provider.js';
import { modelsTable, modelStagesTable } from '../../database/schema.js';
import * as schema from '../../database/schema.js';
import type {
  IManifestRepository,
  ManifestQueryFilter,
  ManifestStageRecord,
  ModelRecord,
  StageTimingAggregate,
} from '../domain/manifest.repository.interface.js';

@Injectable()
export class DrizzleManifestRepository implements IManifestRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: BetterSQLite3Database<typeof schema>,
  ) {}

  async findAll(filter?: ManifestQueryFilter): Promise<readonly ModelRecord[]> {
    const conditions = [];

    if (filter?.query) {
      conditions.push(like(modelsTable.prompt, `%${filter.query}%`));
    }
    if (filter?.status) {
      conditions.push(eq(modelsTable.status, filter.status));
    }
    if (filter?.minTotalSeconds !== undefined) {
      conditions.push(gte(modelsTable.totalSeconds, filter.minTotalSeconds));
    }
    if (filter?.maxTotalSeconds !== undefined) {
      conditions.push(lte(modelsTable.totalSeconds, filter.maxTotalSeconds));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let query = this.db
      .select()
      .from(modelsTable)
      .where(whereClause)
      .orderBy(desc(modelsTable.updatedAt));

    if (filter?.limit !== undefined) {
      query = query.limit(filter.limit) as typeof query;
    }
    if (filter?.offset !== undefined) {
      query = query.offset(filter.offset) as typeof query;
    }

    const rows = await query;
    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      prompt: row.prompt ?? undefined,
      fluxPrompt: row.fluxPrompt ?? undefined,
      status: row.status,
      chosenPick: row.chosenPick ?? undefined,
      totalSeconds: row.totalSeconds ?? 0,
      totalCostUsd: row.totalCostUsd ?? 0,
      primaryMeshPath: row.primaryMeshPath ?? undefined,
      sheetPath: row.sheetPath ?? undefined,
      previewPath: row.previewPath ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async findById(id: string): Promise<ModelRecord | null> {
    const [row] = await this.db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.id, id))
      .limit(1);

    if (!row) return null;

    const stageRows = await this.db
      .select()
      .from(modelStagesTable)
      .where(eq(modelStagesTable.modelId, id));

    const stages: ManifestStageRecord[] = stageRows.map((s) => ({
      stageId: s.stageId,
      status: s.status,
      seconds: s.seconds ?? 0,
      costUsd: s.costUsd ?? 0,
      costNote: s.costNote ?? undefined,
      parameters: s.parameters ? JSON.parse(s.parameters) : undefined,
      metrics: s.metrics ? JSON.parse(s.metrics) : undefined,
      data: s.data ? JSON.parse(s.data) : undefined,
      at: s.timestamp ?? row.updatedAt,
    }));

    return {
      id: row.id,
      subject: row.subject,
      prompt: row.prompt ?? undefined,
      fluxPrompt: row.fluxPrompt ?? undefined,
      status: row.status,
      chosenPick: row.chosenPick ?? undefined,
      totalSeconds: row.totalSeconds ?? 0,
      totalCostUsd: row.totalCostUsd ?? 0,
      primaryMeshPath: row.primaryMeshPath ?? undefined,
      sheetPath: row.sheetPath ?? undefined,
      previewPath: row.previewPath ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      stages,
    };
  }

  async save(model: ModelRecord): Promise<void> {
    const now = new Date().toISOString();
    const totalSeconds =
      model.stages?.reduce((acc, s) => acc + (s.seconds || 0), 0) ??
      model.totalSeconds ??
      0;
    const totalCostUsd =
      model.stages?.reduce((acc, s) => acc + (s.costUsd || 0), 0) ??
      model.totalCostUsd ??
      0;

    // Upsert into modelsTable
    await this.db
      .insert(modelsTable)
      .values({
        id: model.id,
        subject: model.subject,
        prompt: model.prompt ?? null,
        fluxPrompt: model.fluxPrompt ?? null,
        status: model.status,
        chosenPick: model.chosenPick ?? null,
        totalSeconds,
        totalCostUsd,
        primaryMeshPath: model.primaryMeshPath ?? null,
        sheetPath: model.sheetPath ?? null,
        previewPath: model.previewPath ?? null,
        createdAt: model.createdAt || now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: modelsTable.id,
        set: {
          subject: model.subject,
          prompt: model.prompt ?? null,
          fluxPrompt: model.fluxPrompt ?? null,
          status: model.status,
          chosenPick: model.chosenPick ?? null,
          totalSeconds,
          totalCostUsd,
          primaryMeshPath: model.primaryMeshPath ?? null,
          sheetPath: model.sheetPath ?? null,
          previewPath: model.previewPath ?? null,
          updatedAt: now,
        },
      });

    // Replace stages if provided
    if (model.stages && model.stages.length > 0) {
      await this.db
        .delete(modelStagesTable)
        .where(eq(modelStagesTable.modelId, model.id));

      for (const stage of model.stages) {
        await this.db.insert(modelStagesTable).values({
          id: randomUUID(),
          modelId: model.id,
          stageId: stage.stageId,
          status: stage.status,
          seconds: stage.seconds,
          costUsd: stage.costUsd,
          costNote: stage.costNote ?? null,
          parameters: stage.parameters ? JSON.stringify(stage.parameters) : null,
          metrics: stage.metrics ? JSON.stringify(stage.metrics) : null,
          data: stage.data ? JSON.stringify(stage.data) : null,
          timestamp: stage.at,
        });
      }
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(modelsTable)
      .where(eq(modelsTable.id, id));
    return result.changes > 0;
  }

  async getStageAggregates(): Promise<readonly StageTimingAggregate[]> {
    const rows = await this.db
      .select({
        stageId: modelStagesTable.stageId,
        sampleCount: count(),
        avgSeconds: avg(modelStagesTable.seconds),
        minSeconds: min(modelStagesTable.seconds),
        maxSeconds: max(modelStagesTable.seconds),
        totalCostUsd: sum(modelStagesTable.costUsd),
      })
      .from(modelStagesTable)
      .where(eq(modelStagesTable.status, 'DONE'))
      .groupBy(modelStagesTable.stageId);

    return rows.map((r) => ({
      stageId: r.stageId,
      sampleCount: Number(r.sampleCount) || 0,
      avgSeconds: Math.round((Number(r.avgSeconds) || 0) * 100) / 100,
      minSeconds: Math.round((Number(r.minSeconds) || 0) * 100) / 100,
      maxSeconds: Math.round((Number(r.maxSeconds) || 0) * 100) / 100,
      totalCostUsd: Math.round((Number(r.totalCostUsd) || 0) * 10000) / 10000,
    }));
  }

  async getTotalTimes(): Promise<
    readonly {
      id: string;
      subject: string;
      totalSeconds: number;
      stagesCount: number;
    }[]
  > {
    const rows = await this.db
      .select({
        id: modelsTable.id,
        subject: modelsTable.subject,
        totalSeconds: modelsTable.totalSeconds,
      })
      .from(modelsTable)
      .orderBy(desc(modelsTable.totalSeconds));

    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      totalSeconds: Math.round((r.totalSeconds || 0) * 100) / 100,
      stagesCount: 0,
    }));
  }

  async count(filter?: ManifestQueryFilter): Promise<number> {
    const conditions = [];
    if (filter?.query) {
      conditions.push(like(modelsTable.prompt, `%${filter.query}%`));
    }
    if (filter?.status) {
      conditions.push(eq(modelsTable.status, filter.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const [res] = await this.db
      .select({ value: count() })
      .from(modelsTable)
      .where(whereClause);

    return Number(res?.value ?? 0);
  }
}
