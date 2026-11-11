import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ApiConfigService } from '../config/config.service.js';
import { PipelineService } from '../pipeline/pipeline.service.js';
import { DRIZZLE_DB } from '../database/database.provider.js';
import { modelsTable, promptsTable } from '../database/schema.js';
import * as schema from '../database/schema.js';
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
    if (!existsSync(modelsDir)) {
      return [];
    }

    let glbFilename = 'model.glb';
    let artFilename = 'art.jpeg';

    try {
      const step2 = this.pipelineService.getStep('s1-step-2');
      const step3 = this.pipelineService.getStep('s2-step-2');
      glbFilename = (step3.outputs?.['model_public'] as string) || 'model.glb';
      artFilename = (step2.outputs?.['art_public'] as string) || 'art.jpeg';
    } catch {
      // Fallback defaults
    }

    const entries = readdirSync(modelsDir, { withFileTypes: true });
    const verifiedModels: CatalogueModelEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }

      const modelId = entry.name;
      const modelDir = join(modelsDir, modelId);
      const glbPath = join(modelDir, glbFilename);
      const artPath = join(modelDir, artFilename);

      if (
        existsSync(glbPath) &&
        existsSync(artPath) &&
        statSync(glbPath).size > 1000
      ) {
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
      .values({
        id: modelId,
        subject: modelId,
        fluxPrompt,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: modelsTable.id,
        set: {
          fluxPrompt: fluxPrompt ?? undefined,
          updatedAt: now,
        },
      })
      .run();
    this.db
      .insert(promptsTable)
      .values({ id: `figure:${modelId}`, stepId: 's1-step-1', modelId, content: prompt, updatedAt: now })
      .onConflictDoUpdate({ target: promptsTable.id, set: { content: prompt, updatedAt: now } })
      .run();
  }

  public findAll(): readonly CatalogueModelEntry[] {
    const rows = this.db.select().from(modelsTable).orderBy(asc(modelsTable.id)).all();
    if (rows.length === 0) {
      return this.syncCatalogue();
    }

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

    let glbFilename = 'model.glb';
    let allowedExtensions = ['.jpeg', '.jpg', '.png'];
    let alternativesCount = 6;
    let stage0DirName = 'stage-1';

    try {
      const step1 = this.pipelineService.getStep('s1-step-1');
      const step3 = this.pipelineService.getStep('s2-step-2');
      glbFilename = (step3.outputs?.['model_public'] as string) || 'model.glb';
      stage0DirName = step1.stage_dir || 'stage-1';
      if (Array.isArray(step1.outputs?.['allowed_extensions'])) {
        allowedExtensions = step1.outputs['allowed_extensions'] as string[];
      }
      if (step1.parameters?.['alternatives_count']) {
        alternativesCount = Number(step1.parameters['alternatives_count']);
      }
    } catch {
      // Use fallback defaults
    }

    const stage0Dir = join(resourceDir, stage0DirName);

    // Look for alternatives sheet
    const sheetCandidates: string[] = [];
    for (const ext of allowedExtensions) {
      sheetCandidates.push(join(stage0Dir, `s1-step-1-alternatives${ext}`));
      sheetCandidates.push(join(stage0Dir, `step-1-alternatives${ext}`));
      sheetCandidates.push(join(stage0Dir, `alternatives${ext}`));
      sheetCandidates.push(join(modelDir, `alternatives${ext}`));
    }
    const hasAlternatives = sheetCandidates.some((p) => existsSync(p));

    const cachedPicks = this.trellisPicksOf(resourceDir, alternativesCount);
    const pubModelGlb = join(modelDir, glbFilename);
    const hasMesh = existsSync(pubModelGlb) && statSync(pubModelGlb).size > 1000;
    const row = this.db.select().from(modelsTable).where(eq(modelsTable.id, cleanName)).get();
    const currentPick = row?.chosenPick ?? null;

    return {
      id: cleanName,
      hasAlternatives,
      sheetUrl: hasAlternatives ? `/api/v1/models/${cleanName}/sheet` : null,
      cachedPicks,
      currentPick,
      hasMesh,
      meshUrl: hasMesh ? `/api/v1/models/${cleanName}/mesh` : null,
      previews: this.previewsReader.previewsOf(cleanName),
    };
  }

  public getSheet(name: string): SheetFileResponse {
    const cleanName = this.configService.cleanName(name);
    const resourceDir = this.configService.resourceDir(cleanName);
    const modelDir = this.configService.modelDir(cleanName);

    const candidates = [
      join(resourceDir, 'stage-1', 's1-step-1-alternatives.jpeg'),
      join(resourceDir, 'stage-1', 's1-step-1-alternatives.png'),
      join(resourceDir, 'stage-1', 'step-1-alternatives.jpeg'),
      join(resourceDir, 'stage-1', 'step-1-alternatives.png'),
      join(resourceDir, 'stage-1', 'alternatives.jpeg'),
      join(resourceDir, 'stage-1', 'alternatives.png'),
      join(modelDir, 'alternatives.jpeg'),
      join(modelDir, 'alternatives.png'),
    ];

    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        const buffer = readFileSync(filePath);
        const mime = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        return { buffer, mime };
      }
    }

    throw new NotFoundException(`Alternatives sheet for model '${cleanName}' not found`);
  }

  public getMeshPath(name: string): string {
    const cleanName = this.configService.cleanName(name);
    const modelDir = this.configService.modelDir(cleanName);
    const meshPath = join(modelDir, 'model.glb');

    if (!existsSync(meshPath) || statSync(meshPath).size < 1000) {
      throw new NotFoundException(`Mesh (.glb) for model '${cleanName}' not found`);
    }

    return meshPath;
  }

  public getAssemblyPlan(name: string): string {
    const cleanName = this.configService.cleanName(name);
    const candidates = [
      join(this.configService.resourceDir(cleanName), 'stage-5', 'step-1-assembly.json'),
      join(this.configService.modelDir(cleanName), 'assembly.json'),
    ];
    for (const file of candidates) {
      if (existsSync(file)) {
        return readFileSync(file, 'utf8');
      }
    }
    const row = this.db.select().from(modelsTable).where(eq(modelsTable.id, cleanName)).get();
    if (row?.assemblyPlan) {
      return row.assemblyPlan;
    }
    throw new NotFoundException(`Assembly plan for model '${cleanName}' not found`);
  }

  public deleteModel(name: string): { success: boolean; id: string } {
    const cleanName = this.configService.cleanName(name);
    const resourceDir = this.configService.resourceDir(cleanName);
    const modelDir = this.configService.modelDir(cleanName);

    if (existsSync(resourceDir)) {
      rmSync(resourceDir, { recursive: true, force: true });
    }
    if (existsSync(modelDir)) {
      rmSync(modelDir, { recursive: true, force: true });
    }

    this.db.delete(modelsTable).where(eq(modelsTable.id, cleanName)).run();

    this.syncCatalogue();
    return { success: true, id: cleanName };
  }

  /** The arts whose TRELLIS model is kept, so picking one again costs nothing. */
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
