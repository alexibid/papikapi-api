import { Inject, Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ApiConfigService } from '../config/config.service.js';
import { PipelineService } from '../pipeline/pipeline.service.js';

export type FigurePreviewView =
  | 'three-quarter'
  | 'three-quarter-wireframe';

export interface FigurePreview {
  readonly view: FigurePreviewView;
  readonly image: string;
}

const PREVIEWS_STEP_ID = 's3-step-6';

const PREVIEW_OUTPUTS: readonly (readonly [FigurePreviewView, string])[] = [
  ['three-quarter', 'three_quarter_public'],
  ['three-quarter-wireframe', 'three_quarter_wire_public'],
];

@Injectable()
export class ModelPreviewsReader {
  constructor(
    @Inject(ApiConfigService) private readonly configService: ApiConfigService,
    @Inject(PipelineService) private readonly pipelineService: PipelineService,
  ) {}

  public previewsOf(modelId: string): readonly FigurePreview[] {
    const modelDir = this.configService.modelDir(modelId);
    return this.declaredPreviews().filter((preview) => existsSync(join(modelDir, preview.image)));
  }

  private declaredPreviews(): readonly FigurePreview[] {
    const outputs = this.pipelineService.getStep(PREVIEWS_STEP_ID).outputs ?? {};
    return PREVIEW_OUTPUTS.flatMap(([view, outputKey]) => {
      const image = outputs[outputKey];
      return typeof image === 'string' ? [{ view, image }] : [];
    });
  }
}
