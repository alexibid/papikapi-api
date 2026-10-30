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
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ApiConfigService } from '../config/config.service.js';
import { PipelineService } from '../pipeline/pipeline.service.js';

export interface CatalogueModelEntry {
  id: string;
  model: string;
  preview: string;
  image: string;
}

export interface ModelDetailInfo {
  name: string;
  hasAlternatives: boolean;
  sheetUrl: string | null;
  cachedPicks: number[];
  currentPick: number | null;
  hasMesh: boolean;
  meshUrl: string | null;
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
      const step3 = this.pipelineService.getStep('s2-step-1');
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
          model: glbFilename,
          preview: artFilename,
          image: artFilename,
        });
      }
    }

    verifiedModels.sort((a, b) => a.id.localeCompare(b.id));

    writeFileSync(
      this.configService.indexFile,
      `${JSON.stringify(verifiedModels, null, 2)}\n`,
      'utf8',
    );

    return verifiedModels;
  }

  public findAll(): readonly CatalogueModelEntry[] {
    const indexFile = this.configService.indexFile;
    if (existsSync(indexFile)) {
      try {
        const raw = readFileSync(indexFile, 'utf8');
        return JSON.parse(raw) as CatalogueModelEntry[];
      } catch {
        return this.syncCatalogue();
      }
    }
    return this.syncCatalogue();
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
      const step3 = this.pipelineService.getStep('s2-step-1');
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

    // Look for cached picks
    const cachedPicks: number[] = [];
    for (let p = 1; p <= alternativesCount; p++) {
      const pubPickGlb = join(modelDir, `model_pick_${p}.glb`);
      if (existsSync(pubPickGlb) && statSync(pubPickGlb).size > 1000) {
        cachedPicks.push(p);
      }
    }

    // Look for final model mesh
    const pubModelGlb = join(modelDir, glbFilename);
    const hasMesh = existsSync(pubModelGlb) && statSync(pubModelGlb).size > 1000;

    // Detect current pick from stage manifests if available
    let currentPick: number | null = null;
    const manifestPath = join(stage0Dir, 's1-step-2-manifest.json');
    if (existsSync(manifestPath) && hasMesh) {
      try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (parsed?.data?.chosenPick) {
          currentPick = Number(parsed.data.chosenPick);
          if (!cachedPicks.includes(currentPick)) {
            cachedPicks.push(currentPick);
          }
        }
      } catch {
        // Ignore parse error
      }
    }

    cachedPicks.sort((a, b) => a - b);

    return {
      name: cleanName,
      hasAlternatives,
      sheetUrl: hasAlternatives ? `/api/v1/models/${cleanName}/sheet` : null,
      cachedPicks,
      currentPick,
      hasMesh,
      meshUrl: hasMesh ? `/api/v1/models/${cleanName}/mesh` : null,
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

  public deleteModel(name: string): { success: boolean; name: string } {
    const cleanName = this.configService.cleanName(name);
    const resourceDir = this.configService.resourceDir(cleanName);
    const modelDir = this.configService.modelDir(cleanName);

    if (existsSync(resourceDir)) {
      rmSync(resourceDir, { recursive: true, force: true });
    }
    if (existsSync(modelDir)) {
      rmSync(modelDir, { recursive: true, force: true });
    }

    this.syncCatalogue();
    return { success: true, name: cleanName };
  }
}
