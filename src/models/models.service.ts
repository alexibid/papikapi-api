import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ApiConfigService } from '../config/config.service.js';
import { DRIZZLE_DB } from '../database/database.provider.js';
import * as schema from '../database/schema.js';
import { modelsTable, promptsTable } from '../database/schema.js';
import { PipelineService } from '../pipeline/pipeline.service.js';
import { FigurePreview, ModelPreviewsReader } from './model-previews.js';

export interface FigureDisplayNames {
  readonly pt: string;
  readonly en: string;
}

export interface CatalogueModelEntry {
  id: string;
  displayName: FigureDisplayNames;
  model: string;
  preview: string;
  image: string;
  previews: readonly FigurePreview[];
}

export interface ModelDetailInfo {
  id: string;
  hasAlternatives: boolean;
  sheetUrl: string | null;
  cachedPicks: number[];
  currentPick: number | null;
  hasMesh: boolean;
  meshUrl: string | null;
  previews: readonly FigurePreview[];
}

export interface SheetFileResponse {
  buffer: Buffer;
  mime: string;
}

interface DetailPipelineConfig {
  readonly glbFilename: string;
  readonly allowedExtensions: readonly string[];
  readonly alternativesCount: number;
  readonly stage0DirName: string;
}

@Injectable()
export class ModelsService {
  constructor(
    @Inject(ApiConfigService) private readonly configService: ApiConfigService,
    @Inject(PipelineService) private readonly pipelineService: PipelineService,
    @Inject(DRIZZLE_DB) private readonly db: BetterSQLite3Database<typeof schema>,
    @Inject(ModelPreviewsReader) private readonly previewsReader: ModelPreviewsReader,
  ) {}

  public syncCatalogue(): readonly CatalogueModelEntry[] {
    const modelsDir = this.configService.modelsDir;
    if (!existsSync(modelsDir)) return [];

    const { glbFilename, artFilename } = this.publicFilenames();
    const verifiedModels: CatalogueModelEntry[] = [];

    for (const entry of readdirSync(modelsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const modelId = entry.name;
      const modelDir = join(modelsDir, modelId);
      const glbPath = join(modelDir, glbFilename);
      const artPath = join(modelDir, artFilename);
      if (existsSync(glbPath) && existsSync(artPath) && statSync(glbPath).size > 1000) {
        verifiedModels.push({
          id: modelId,
          displayName: this.displayNameOf(modelId),
          model: glbFilename,
          preview: artFilename,
          image: artFilename,
          previews: this.previewsReader.previewsOf(modelId),
        });
      }
    }

    verifiedModels.sort((a, b) => a.id.localeCompare(b.id));
    const now = new Date().toISOString();
    for (const m of verifiedModels) {
      const paths = {
        primaryMeshPath: `/api/v1/models/${m.id}/mesh`,
        sheetPath: `/api/v1/models/${m.id}/sheet`,
        previewPath: `/models/${m.id}/${m.preview}`,
      };
      this.db
        .insert(modelsTable)
        .values({ id: m.id, subject: m.id, status: 'DONE', ...paths, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: modelsTable.id, set: paths })
        .run();
    }
    return verifiedModels;
  }

  public recordPrompt(modelId: string, prompt: string, fluxPrompt?: string): void {
    const now = new Date().toISOString();
    this.db
      .insert(modelsTable)
      .values({ id: modelId, subject: modelId, fluxPrompt, status: 'PENDING', createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: modelsTable.id, set: { fluxPrompt: fluxPrompt ?? undefined, updatedAt: now } })
      .run();
    this.db
      .insert(promptsTable)
      .values({ id: `figure:${modelId}`, stepId: 's1-step-1', modelId, content: prompt, updatedAt: now })
      .onConflictDoUpdate({ target: promptsTable.id, set: { content: prompt, updatedAt: now } })
      .run();
  }

  public findAll(): readonly CatalogueModelEntry[] {
    const rows = this.db.select().from(modelsTable).orderBy(asc(modelsTable.id)).all();
    if (rows.length === 0) return this.syncCatalogue();
    return rows.map((r) => ({
      id: r.id,
      displayName: this.displayNamesFrom(r),
      model: 'model.glb',
      preview: 'art.jpeg',
      image: 'art.jpeg',
      previews: this.previewsReader.previewsOf(r.id),
    }));
  }

  public findOne(name: string): ModelDetailInfo {
    const cleanName = this.configService.cleanName(name);
    const modelDir = this.configService.modelDir(cleanName);
    const resourceDir = this.configService.resourceDir(cleanName);
    if (!existsSync(modelDir) && !existsSync(resourceDir)) {
      throw new NotFoundException(`Model '${cleanName}' not found`);
    }

    const detail = this.detailPipelineConfig();
    const stage0Dir = join(resourceDir, detail.stage0DirName);
    const hasAlternatives = this.alternativeSheetCandidates(stage0Dir, modelDir, detail.allowedExtensions).some(
      (filePath) => existsSync(filePath),
    );
    const cachedPicks = this.trellisPicksOf(resourceDir, detail.alternativesCount);
    const pubModelGlb = join(modelDir, detail.glbFilename);
    const hasMesh = existsSync(pubModelGlb) && statSync(pubModelGlb).size > 1000;
    const row = this.db.select().from(modelsTable).where(eq(modelsTable.id, cleanName)).get();

    return {
      id: cleanName,
      hasAlternatives,
      sheetUrl: hasAlternatives ? `/api/v1/models/${cleanName}/sheet` : null,
      cachedPicks,
      currentPick: row?.chosenPick ?? null,
      hasMesh,
      meshUrl: hasMesh ? `/api/v1/models/${cleanName}/mesh` : null,
      previews: this.previewsReader.previewsOf(cleanName),
    };
  }

  public getSheet(name: string): SheetFileResponse {
    const cleanName = this.configService.cleanName(name);
    const stage0Dir = join(this.configService.resourceDir(cleanName), 'stage-1');
    const modelDir = this.configService.modelDir(cleanName);
    for (const filePath of this.alternativeSheetCandidates(stage0Dir, modelDir, ['.jpeg', '.png'])) {
      if (existsSync(filePath)) {
        return { buffer: readFileSync(filePath), mime: filePath.endsWith('.png') ? 'image/png' : 'image/jpeg' };
      }
    }
    throw new NotFoundException(`Alternatives sheet for model '${cleanName}' not found`);
  }

  public getMeshPath(name: string): string {
    const cleanName = this.configService.cleanName(name);
    const meshPath = join(this.configService.modelDir(cleanName), 'model.glb');
    if (!existsSync(meshPath) || statSync(meshPath).size < 1000) {
      throw new NotFoundException(`Mesh (.glb) for model '${cleanName}' not found`);
    }
    return meshPath;
  }

  public getAssemblyPlan(name: string): string {
    const cleanName = this.configService.cleanName(name);
    const row = this.db.select({ assemblyPlan: modelsTable.assemblyPlan }).from(modelsTable).where(eq(modelsTable.id, cleanName)).get();
    if (row?.assemblyPlan && row.assemblyPlan.trim().length > 0) {
      return row.assemblyPlan;
    }
    throw new NotFoundException(`Assembly plan for model '${cleanName}' not found`);
  }

  public deleteModel(name: string): { success: boolean; id: string } {
    const cleanName = this.configService.cleanName(name);
    const resourceDir = this.configService.resourceDir(cleanName);
    const modelDir = this.configService.modelDir(cleanName);
    if (existsSync(resourceDir)) rmSync(resourceDir, { recursive: true, force: true });
    if (existsSync(modelDir)) rmSync(modelDir, { recursive: true, force: true });
    this.db.delete(modelsTable).where(eq(modelsTable.id, cleanName)).run();
    this.syncCatalogue();
    return { success: true, id: cleanName };
  }

  private publicFilenames(): { glbFilename: string; artFilename: string } {
    try {
      const step2 = this.pipelineService.getStep('s1-step-2');
      const step3 = this.pipelineService.getStep('s2-step-2');
      return {
        glbFilename: this.stringField(step3.outputs, 'model_public') ?? 'model.glb',
        artFilename: this.stringField(step2.outputs, 'art_public') ?? 'art.jpeg',
      };
    } catch {
      return { glbFilename: 'model.glb', artFilename: 'art.jpeg' };
    }
  }

  private detailPipelineConfig(): DetailPipelineConfig {
    const defaults: DetailPipelineConfig = {
      glbFilename: 'model.glb',
      allowedExtensions: ['.jpeg', '.jpg', '.png'],
      alternativesCount: 6,
      stage0DirName: 'stage-1',
    };
    try {
      const step1 = this.pipelineService.getStep('s1-step-1');
      const step3 = this.pipelineService.getStep('s2-step-2');
      const configuredExtensions = this.stringArrayField(step1.outputs, 'allowed_extensions');
      return {
        glbFilename: this.stringField(step3.outputs, 'model_public') ?? defaults.glbFilename,
        allowedExtensions: configuredExtensions.length > 0 ? configuredExtensions : defaults.allowedExtensions,
        alternativesCount: step1.parameters?.['alternatives_count'] ? Number(step1.parameters['alternatives_count']) : defaults.alternativesCount,
        stage0DirName: step1.stage_dir || defaults.stage0DirName,
      };
    } catch {
      return defaults;
    }
  }

  private alternativeSheetCandidates(
    stage0Dir: string,
    modelDir: string,
    extensions: readonly string[],
  ): readonly string[] {
    const stagePrefixes = ['s1-step-1-alternatives', 'step-1-alternatives', 'alternatives'];
    return [
      ...stagePrefixes.flatMap((prefix) => extensions.map((ext) => join(stage0Dir, `${prefix}${ext}`))),
      ...extensions.map((ext) => join(modelDir, `alternatives${ext}`)),
    ];
  }

  private stringField(record: Record<string, unknown> | undefined, key: string): string | null {
    const value = record?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private stringArrayField(record: Record<string, unknown> | undefined, key: string): readonly string[] {
    const value = record?.[key];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private trellisPicksOf(resourceDir: string, alternativesCount: number): number[] {
    const picks = Array.from({ length: alternativesCount }, (_, index) => index + 1);
    return picks.filter((pick) => {
      const glb = join(resourceDir, 'stage-2', `step-2-3d-pick-${pick}.glb`);
      return existsSync(glb) && statSync(glb).size > 1000;
    });
  }

  private displayNameOf(id: string): FigureDisplayNames {
    const row = this.db.select().from(modelsTable).where(eq(modelsTable.id, id)).get();
    return row ? this.displayNamesFrom(row) : this.humanizedNames(id);
  }

  private displayNamesFrom(row: typeof modelsTable.$inferSelect): FigureDisplayNames {
    const fallback = this.humanizedNames(row.subject);
    return { pt: row.displayNamePt ?? fallback.pt, en: row.displayNameEn ?? fallback.en };
  }

  private humanizedNames(subject: string): FigureDisplayNames {
    const words = subject.split('-').filter(Boolean).join(' ');
    const name = words.charAt(0).toUpperCase() + words.slice(1);
    return { pt: name, en: name };
  }
}
