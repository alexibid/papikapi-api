import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiConfigService } from '../config/config.service.js';
import {
  IManifestRepository,
  MANIFEST_REPOSITORY,
  ManifestQueryFilter,
  ManifestStageRecord,
  ModelRecord,
} from './domain/manifest.repository.interface.js';

@Injectable()
export class ManifestsService {
  constructor(
    @Inject(MANIFEST_REPOSITORY)
    private readonly repository: IManifestRepository,
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {}

  async findAll(filter?: ManifestQueryFilter) {
    const [items, total] = await Promise.all([
      this.repository.findAll(filter),
      this.repository.count(filter),
    ]);
    return {
      total,
      limit: filter?.limit ?? items.length,
      offset: filter?.offset ?? 0,
      items,
    };
  }

  async findOne(id: string): Promise<ModelRecord> {
    const clean = this.configService.cleanName(id);
    const model = await this.repository.findById(clean);
    if (!model) {
      throw new NotFoundException(`Manifest for model '${id}' not found`);
    }
    return model;
  }

  async getTelemetry(id: string) {
    const model = await this.findOne(id);
    return {
      id: model.id,
      subject: model.subject,
      status: model.status,
      totalSeconds: model.totalSeconds,
      totalCostUsd: model.totalCostUsd,
      stagesCount: model.stages?.length ?? 0,
      stages: model.stages ?? [],
      paths: {
        mesh: model.primaryMeshPath,
        sheet: model.sheetPath,
        preview: model.previewPath,
      },
    };
  }

  async getAnalyticsTimes() {
    const [stageAggregates, totalTimes] = await Promise.all([
      this.repository.getStageAggregates(),
      this.repository.getTotalTimes(),
    ]);

    return {
      stageAggregates,
      topModelsByDuration: totalTimes.slice(0, 10),
    };
  }

  async syncFromDisk(): Promise<{ imported: number; failed: number }> {
    const modelsDir = this.configService.modelsDir;
    if (!existsSync(modelsDir)) {
      return { imported: 0, failed: 0 };
    }

    const entries = readdirSync(modelsDir, { withFileTypes: true });
    let imported = 0;
    let failed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const modelId = entry.name;
      const manifestFile = join(modelsDir, modelId, 'manifest.json');
      if (!existsSync(manifestFile)) continue;

      try {
        const raw = JSON.parse(readFileSync(manifestFile, 'utf-8'));
        const stagesObj = raw.stages || {};
        const stageRecords: ManifestStageRecord[] = [];

        let prompt: string | undefined;
        let fluxPrompt: string | undefined;
        let chosenPick: number | undefined;
        let totalSeconds = 0;
        let totalCostUsd = 0;
        let createdAt = new Date().toISOString();

        for (const [sId, sData] of Object.entries<any>(stagesObj)) {
          const seconds = Number(sData.seconds) || 0;
          const cost = Number(sData.costUsd) || 0;
          totalSeconds += seconds;
          totalCostUsd += cost;

          if (sData.at) {
            createdAt = sData.at;
          }

          if (sData.data?.prompt) {
            prompt = sData.data.prompt;
          }
          if (sData.data?.fluxPrompt) {
            fluxPrompt = sData.data.fluxPrompt;
          }
          if (sData.data?.chosenPick !== undefined) {
            chosenPick = Number(sData.data.chosenPick);
          }

          stageRecords.push({
            stageId: sData.stageId || sId,
            status: sData.status || 'DONE',
            seconds,
            costUsd: cost,
            costNote: sData.costNote,
            parameters: sData.data?.parameters || undefined,
            metrics: sData.metrics || undefined,
            data: sData.data || undefined,
            at: sData.at || new Date().toISOString(),
          });
        }

        const modelRecord: ModelRecord = {
          id: modelId,
          subject: raw.subject || modelId,
          prompt,
          fluxPrompt,
          status: 'DONE',
          chosenPick,
          totalSeconds: Math.round(totalSeconds * 100) / 100,
          totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
          primaryMeshPath: `/api/v1/models/${modelId}/mesh`,
          sheetPath: `/api/v1/models/${modelId}/sheet`,
          previewPath: `/models/${modelId}/art.jpeg`,
          createdAt,
          updatedAt: new Date().toISOString(),
          stages: stageRecords,
        };

        await this.repository.save(modelRecord);
        imported++;
      } catch (err) {
        failed++;
      }
    }

    return { imported, failed };
  }
}
