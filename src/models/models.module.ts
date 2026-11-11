import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { ModelsController } from './models.controller.js';
import { ModelPreviewsReader } from './model-previews.js';
import { ModelsService } from './models.service.js';

@Module({
  imports: [DatabaseModule, PipelineModule],
  controllers: [ModelsController],
  providers: [ModelsService, ModelPreviewsReader],
  exports: [ModelsService],
})
export class ModelsModule {}
