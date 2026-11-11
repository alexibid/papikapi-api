import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PipelineConfig, PipelineService } from './pipeline.service.js';

export interface PipelineStepOutline {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly expectedSeconds: number | null;
}

export interface PipelineStageOutline {
  readonly stage: string;
  readonly steps: readonly PipelineStepOutline[];
}

@ApiTags('pipeline')
@Controller('api/v1/pipeline')
export class PipelineController {
  constructor(@Inject(PipelineService) private readonly pipelineService: PipelineService) {}

  @Get('config')
  @ApiOperation({ summary: 'The full active pipeline configuration' })
  getConfig(): PipelineConfig {
    return this.pipelineService.getConfig();
  }

  @Get('stages')
  @ApiOperation({ summary: 'The stages and their steps, in running order' })
  getStages(): readonly PipelineStageOutline[] {
    return this.pipelineService.getStages().map((stage) => ({
      stage: stage.stage,
      steps: stage.steps.map((step) => ({
        id: step.id,
        name: step.name,
        label: step.label ?? step.name,
        expectedSeconds: typeof step['expected_seconds'] === 'number' ? step['expected_seconds'] : null,
      })),
    }));
  }
}
