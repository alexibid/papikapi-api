import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module.js';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { GeneratorController } from './generator.controller.js';
import { GeneratorService } from './generator.service.js';
import { ImageService } from './image/image.service.js';
import { ProgressService } from './progress/progress.service.js';
import { RunPodService } from './runpod/runpod.service.js';

@Module({
  imports: [PipelineModule, ModelsModule],
  controllers: [GeneratorController],
  providers: [
    GeneratorService,
    ProgressService,
    RunPodService,
    ImageService,
  ],
  exports: [GeneratorService, ProgressService],
})
export class GeneratorModule {}
