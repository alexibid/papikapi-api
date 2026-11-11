import { Inject, Injectable } from '@nestjs/common';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ApiConfigService } from '../../config/config.service.js';
import { PipelineService } from '../../pipeline/pipeline.service.js';
import type { PublishedFile } from '../domain/manifest.types.js';

interface DeclaredFile {
  readonly kind: string;
  readonly stepId: string;
  readonly output: string;
}

const PUBLIC_FILES: readonly DeclaredFile[] = [
  { kind: 'art', stepId: 's1-step-2', output: 'art_public' },
  { kind: 'model', stepId: 's2-step-2', output: 'model_public' },
  { kind: 'preview-three-quarter', stepId: 's3-step-6', output: 'three_quarter_public' },
  { kind: 'preview-three-quarter-wireframe', stepId: 's3-step-6', output: 'three_quarter_wire_public' },
  { kind: 'sheets', stepId: 's4-step-2', output: 'sheets_public' },
];

const ASSEMBLY_FILE = join('stage-5', 'step-1-assembly.json');

/** The files a figure has published, named by the pipeline config, with their public link and size. */
@Injectable()
export class PublishedFiles {
  constructor(
    @Inject(ApiConfigService) private readonly configService: ApiConfigService,
    @Inject(PipelineService) private readonly pipelineService: PipelineService,
  ) {}

  public of(modelId: string): readonly PublishedFile[] {
    const modelDir = this.configService.modelDir(modelId);
    const published = PUBLIC_FILES.flatMap((declared) => {
      const name = this.pipelineService.getStep(declared.stepId).outputs?.[declared.output];
      if (typeof name !== 'string') return [];
      const path = join(modelDir, name);
      return existsSync(path) ? [{ kind: declared.kind, url: `/models/${modelId}/${name}`, bytes: statSync(path).size }] : [];
    });
    const assembly = join(this.configService.resourceDir(modelId), ASSEMBLY_FILE);
    return existsSync(assembly)
      ? [...published, { kind: 'assembly', url: `/api/v1/models/${modelId}/assembly`, bytes: statSync(assembly).size }]
      : published;
  }
}
