import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { ModelsController } from './models.controller.js';
import { ModelsService } from './models.service.js';

@Module({
  imports: [PipelineModule],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService],
})
export class ModelsModule {}
