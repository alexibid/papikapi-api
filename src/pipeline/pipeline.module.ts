import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PipelineController } from './pipeline.controller.js';
import { PipelineService } from './pipeline.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
