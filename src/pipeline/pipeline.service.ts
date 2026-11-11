import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { DRIZZLE_DB } from '../database/database.provider.js';
import * as schema from '../database/schema.js';

export interface PipelineStep {
  id: string;
  name: string;
  label?: string;
  stage_dir?: string;
  script?: string;
  parameters?: Record<string, unknown>;
  serverless?: Record<string, unknown>;
  outputs?: {
    sheet_resource?: string;
    sheet_public?: string;
    art_public?: string;
    model_public?: string;
    model_pick_public_pattern?: string;
    manifest?: string;
    allowed_extensions?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PipelineStage {
  stage: string;
  steps: PipelineStep[];
}

export interface PipelineConfig {
  system?: string;
  workspace?: {
    models_dir: string;
    resources_dir: string;
    [key: string]: unknown;
  };
  pricing?: Record<string, unknown>;
  pipeline_stages: PipelineStage[];
  [key: string]: unknown;
}

@Injectable()
export class PipelineService implements OnModuleInit {
  private config: PipelineConfig | null = null;
  private currentVersionId: string | null = null;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: BetterSQLite3Database<typeof schema>,
  ) {}

  onModuleInit(): void {
    this.loadConfig();
  }

  public loadConfig(requestedVersion?: string): PipelineConfig {
    let row: typeof schema.pipelineVersionsTable.$inferSelect | undefined;

    if (requestedVersion) {
      row = this.db
        .select()
        .from(schema.pipelineVersionsTable)
        .where(eq(schema.pipelineVersionsTable.id, requestedVersion))
        .get();
    } else {
      const activeSetting = this.db
        .select()
        .from(schema.systemSettingsTable)
        .where(eq(schema.systemSettingsTable.key, 'active_pipeline_version'))
        .get();
      const activeVersion = activeSetting?.value;
      if (activeVersion) {
        row = this.db
          .select()
          .from(schema.pipelineVersionsTable)
          .where(eq(schema.pipelineVersionsTable.id, activeVersion))
          .get();
      }
      if (!row) {
        row = this.db
          .select()
          .from(schema.pipelineVersionsTable)
          .where(eq(schema.pipelineVersionsTable.isActive, 1))
          .get();
      }
    }

    if (!row) {
      throw new Error(`Pipeline configuration not found in database (version: ${requestedVersion ?? 'active'})`);
    }

    try {
      this.config = JSON.parse(row.config) as PipelineConfig;
      this.currentVersionId = row.id;
      return this.config;
    } catch (err) {
      throw new Error(`Failed to parse pipeline config from database: ${(err as Error).message}`);
    }
  }

  public getConfig(): PipelineConfig {
    if (!this.config) {
      return this.loadConfig();
    }
    return this.config;
  }

  public getStages(): PipelineStage[] {
    return this.getConfig().pipeline_stages || [];
  }

  public getStep(stepId: string): PipelineStep {
    const config = this.getConfig();
    for (const stage of config.pipeline_stages || []) {
      for (const step of stage.steps || []) {
        if (step.id === stepId) {
          return step;
        }
      }
    }
    throw new Error(`Step not found in pipeline config: ${stepId}`);
  }
}
