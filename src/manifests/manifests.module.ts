import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { ManifestStore } from './infrastructure/manifest-store.js';
import { PublishedFiles } from './infrastructure/published-files.js';
import { ManifestsController } from './manifests.controller.js';
import { ManifestsService } from './manifests.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule, PipelineModule],
  controllers: [ManifestsController],
  providers: [ManifestsService, ManifestStore, PublishedFiles],
})
export class ManifestsModule {}
