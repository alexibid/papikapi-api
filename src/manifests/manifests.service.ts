import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ApiConfigService } from '../config/config.service.js';
import { PipelineService } from '../pipeline/pipeline.service.js';
import { detailOf } from './domain/figure-manifest.js';
import { pageOf } from './domain/manifest-listing.js';
import { overviewOf } from './domain/manifest-overview.js';
import type {
  FigureSources,
  ManifestDetail,
  ManifestListQuery,
  ManifestOverview,
  ManifestPage,
  PipelineStepInfo,
} from './domain/manifest.types.js';
import { ManifestStore, StoredFigure } from './infrastructure/manifest-store.js';
import { PublishedFiles } from './infrastructure/published-files.js';

@Injectable()
export class ManifestsService {
  constructor(
    @Inject(ManifestStore) private readonly store: ManifestStore,
    @Inject(PublishedFiles) private readonly files: PublishedFiles,
    @Inject(PipelineService) private readonly pipelineService: PipelineService,
    @Inject(ApiConfigService) private readonly configService: ApiConfigService,
  ) {}

  public list(query: ManifestListQuery): ManifestPage {
    return pageOf(this.allFigures(), this.pipelineSteps(), query);
  }

  public detail(id: string): ManifestDetail {
    const stored = this.store.one(this.configService.cleanName(id));
    if (!stored) {
      throw new NotFoundException(`Figure '${id}' has no manifest`);
    }
    return detailOf(this.withFiles(stored), this.pipelineSteps());
  }

  public overview(estimateFigures: number): ManifestOverview {
    return overviewOf(this.allFigures(), this.pipelineSteps(), estimateFigures);
  }

  private allFigures(): readonly FigureSources[] {
    return this.store.all().map((stored) => this.withFiles(stored));
  }

  private withFiles(stored: StoredFigure): FigureSources {
    return { ...stored, files: this.files.of(stored.model.id) };
  }

  private pipelineSteps(): readonly PipelineStepInfo[] {
    return this.pipelineService.getStages().flatMap((stage) =>
      stage.steps.map((step) => ({ stageId: step.id, stage: stage.stage, name: step.name, label: step.label ?? step.name })));
  }
}
