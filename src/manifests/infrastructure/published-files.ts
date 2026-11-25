import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ApiConfigService } from '../../config/config.service.js';
import { DRIZZLE_DB } from '../../database/database.provider.js';
import * as schema from '../../database/schema.js';
import { modelsTable } from '../../database/schema.js';
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

@Injectable()
export class PublishedFiles {
  constructor(
    @Inject(ApiConfigService) private readonly configService: ApiConfigService,
    @Inject(PipelineService) private readonly pipelineService: PipelineService,
    @Inject(DRIZZLE_DB) private readonly db: BetterSQLite3Database<typeof schema>,
  ) {}

  public of(modelId: string): readonly PublishedFile[] {
    const modelDir = this.configService.modelDir(modelId);
    const published = PUBLIC_FILES.flatMap((declared) => {
      const name = this.pipelineService.getStep(declared.stepId).outputs?.[declared.output];
      if (typeof name !== 'string') return [];
      const path = join(modelDir, name);
      return existsSync(path)
        ? [{ kind: declared.kind, url: `/models/${modelId}/${name}`, bytes: statSync(path).size }]
        : [];
    });
    const row = this.db
      .select({ assemblyPlan: modelsTable.assemblyPlan })
      .from(modelsTable)
      .where(eq(modelsTable.id, modelId))
      .get();
    return row?.assemblyPlan && row.assemblyPlan.trim().length > 0
      ? [
          ...published,
          {
            kind: 'assembly',
            url: `/api/v1/models/${modelId}/assembly`,
            bytes: Buffer.byteLength(row.assemblyPlan, 'utf8'),
          },
        ]
      : published;
  }
}
