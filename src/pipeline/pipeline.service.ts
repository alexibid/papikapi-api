import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { ApiConfigService } from '../config/config.service.js';

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

  constructor(@Inject(ApiConfigService) private readonly configService: ApiConfigService) {}

  onModuleInit(): void {
    this.loadConfig();
  }

  public loadConfig(): PipelineConfig {
    const filePath = this.configService.pipelinePath;
    if (!existsSync(filePath)) {
      throw new Error(`Pipeline config file not found at: ${filePath}`);
    }

    try {
      const raw = readFileSync(filePath, 'utf8');
      this.config = JSON.parse(raw) as PipelineConfig;
      return this.config;
    } catch (err) {
      throw new Error(`Failed to parse pipeline config: ${(err as Error).message}`);
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
