import { Controller, Get, Inject } from '@nestjs/common';
import { PipelineConfig, PipelineStage, PipelineService } from './pipeline.service.js';

@Controller()
export class PipelineController {
  constructor(@Inject(PipelineService) private readonly pipelineService: PipelineService) {}

  @Get(['api/v1/pipeline/config', 'api/pipeline'])
  getConfig(): PipelineConfig {
    return this.pipelineService.getConfig();
  }

  @Get('api/v1/pipeline/stages')
  getStages(): PipelineStage[] {
    return this.pipelineService.getStages();
  }
}
