import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiConfigService } from '../config/config.service.js';
import { ModelsService } from '../models/models.service.js';
import { PipelineService } from '../pipeline/pipeline.service.js';
import { ImageService } from './image/image.service.js';
import { ProgressService } from './progress/progress.service.js';
import { RunPodService } from './runpod/runpod.service.js';

export interface GenerateAlternativesPayload {
  prompt: string;
  name?: string;
  images?: string[];
}

export interface SynthesizePayload {
  name: string;
  pick: number | string;
}

@Injectable()
export class GeneratorService {
  private readonly logger = new Logger(GeneratorService.name);

  constructor(
    @Inject(ApiConfigService) private readonly configService: ApiConfigService,
    @Inject(PipelineService) private readonly pipelineService: PipelineService,
    @Inject(ModelsService) private readonly modelsService: ModelsService,
    @Inject(ImageService) private readonly imageService: ImageService,
    @Inject(RunPodService) private readonly runpodService: RunPodService,
    @Inject(ProgressService) private readonly progressService: ProgressService,
  ) {}

  public async generateAlternatives(payload: GenerateAlternativesPayload) {
    if (!payload.prompt || payload.prompt.trim().length === 0) {
      throw new BadRequestException('Prompt is required');
    }

    const cleanName = this.resolveModelName(payload.name, payload.prompt);
    const stageDir = join(this.configService.resourceDir(cleanName), 'stage-1');
    const publicDir = this.configService.modelDir(cleanName);

    mkdirSync(stageDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });

    this.progressService.begin(cleanName, ['s1-step-1']);

    try {
      this.progressService.report(cleanName, 's1-step-1', 'Composing prompt and calling FLUX worker...');

      let endpointId = '';
      try {
        const step1 = this.pipelineService.getStep('s1-step-1');
        const envKey = (step1.serverless?.['env_endpoint_key'] as string) || 'RUNPOD_FLUX_ENDPOINT_ID';
        endpointId = this.runpodService.getEndpointId(envKey);
      } catch (err) {
        this.logger.warn(`Could not read FLUX endpoint ID: ${(err as Error).message}`);
      }

      if (!endpointId) {
        throw new Error('RunPod FLUX endpoint ID not configured. Please set RUNPOD_FLUX_ENDPOINT_ID.');
      }

      const referenceImages = Array.isArray(payload.images) && payload.images.length > 0
        ? payload.images.map((img) => this.imageService.dataUrlToBuffer(img).buffer.toString('base64'))
        : [];

      const result = await this.runpodService.execute<
        { prompt: string; reference_images?: string[]; num_images?: number },
        { image: string; lora?: string; seeds?: number[] }
      >(endpointId, {
        prompt: payload.prompt,
        reference_images: referenceImages,
        num_images: 6,
      });

      if (!result.output?.image) {
        throw new Error('Worker completed but returned no image data');
      }

      const imageBuffer = Buffer.from(result.output.image, 'base64');
      const stageFilePath = join(stageDir, 's1-step-1-alternatives.jpeg');
      const pubFilePath = join(publicDir, 'alternatives.jpeg');

      writeFileSync(stageFilePath, imageBuffer);
      writeFileSync(pubFilePath, imageBuffer);

      // Save prompt metadata
      writeFileSync(join(publicDir, 'prompt.txt'), payload.prompt, 'utf8');

      this.progressService.finish(cleanName, 'Alternatives generated successfully');

      return {
        success: true,
        name: cleanName,
        sheetUrl: `/api/v1/models/${cleanName}/sheet`,
        executionTimeSec: result.executionTimeSec,
      };
    } catch (err) {
      const msg = (err as Error).message;
      this.progressService.fail(cleanName, msg);
      throw err;
    }
  }

  public async synthesize(payload: SynthesizePayload) {
    if (!payload.name) {
      throw new BadRequestException('Model name is required');
    }

    const cleanName = this.configService.cleanName(payload.name);
    const pick = Number(payload.pick);

    if (isNaN(pick) || pick < 1 || pick > 6) {
      throw new BadRequestException('Pick must be an integer between 1 and 6');
    }

    const stage0Dir = join(this.configService.resourceDir(cleanName), 'stage-1');
    const publicDir = this.configService.modelDir(cleanName);

    mkdirSync(stage0Dir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });

    this.progressService.begin(cleanName, ['s1-step-2', 's2-step-1']);

    try {
      this.progressService.report(cleanName, 's1-step-2', `Cropping alternative #${pick}...`);

      const sheet = this.modelsService.getSheet(cleanName);
      const croppedArt = await this.imageService.cropCell(sheet.buffer, {
        columns: 3,
        rows: 2,
        pickIndex: pick,
      });

      const artStagePath = join(stage0Dir, 'step-2-art.jpeg');
      const artPickPath = join(publicDir, `art-pick-${pick}.jpeg`);
      const artPubFinal = join(publicDir, 'art.jpeg');

      writeFileSync(artStagePath, croppedArt);
      writeFileSync(artPickPath, croppedArt);
      writeFileSync(artPubFinal, croppedArt);

      this.progressService.report(cleanName, 's2-step-1', 'Reconstructing 3D mesh via TRELLIS...');

      let trellisEndpointId = '';
      try {
        const step3 = this.pipelineService.getStep('s2-step-1');
        const envKey = (step3.serverless?.['env_endpoint_key'] as string) || 'RUNPOD_TRELLIS_ENDPOINT_ID';
        trellisEndpointId = this.runpodService.getEndpointId(envKey);
      } catch (err) {
        this.logger.warn(`Could not read TRELLIS endpoint ID: ${(err as Error).message}`);
      }

      if (!trellisEndpointId) {
        throw new Error('RunPod TRELLIS endpoint ID not configured. Please set RUNPOD_TRELLIS_ENDPOINT_ID.');
      }

      const trellisResult = await this.runpodService.execute<
        { image: string; seed?: number },
        { glb: string; seed?: number }
      >(trellisEndpointId, {
        image: croppedArt.toString('base64'),
      });

      if (!trellisResult.output?.glb) {
        throw new Error('TRELLIS worker completed but returned no GLB data');
      }

      const glbBuffer = Buffer.from(trellisResult.output.glb, 'base64');
      const pickGlbPath = join(publicDir, `model_pick_${pick}.glb`);
      const finalGlbPath = join(publicDir, 'model.glb');

      writeFileSync(pickGlbPath, glbBuffer);
      writeFileSync(finalGlbPath, glbBuffer);

      // Save pick manifest
      const manifestPath = join(stage0Dir, 's1-step-2-manifest.json');
      writeFileSync(
        manifestPath,
        JSON.stringify({ status: 'DONE', data: { chosenPick: pick } }, null, 2),
        'utf8',
      );

      this.modelsService.syncCatalogue();
      this.progressService.finish(cleanName, '3D model synthesized successfully');

      return {
        success: true,
        name: cleanName,
        pick,
        modelPath: `/models/${cleanName}/model.glb`,
        artPath: `/models/${cleanName}/art.jpeg`,
      };
    } catch (err) {
      const msg = (err as Error).message;
      this.progressService.fail(cleanName, msg);
      throw err;
    }
  }

  private resolveModelName(name?: string, prompt?: string): string {
    const clean = this.configService.cleanName(name || '');
    if (clean && clean !== 'model' && clean !== 'custom-model') {
      return clean;
    }
    if (prompt) {
      const derived = this.configService.cleanName(prompt.slice(0, 32));
      if (derived) return derived;
    }
    return 'model';
  }
}
