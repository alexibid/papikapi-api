import { Body, Controller, Get, Post } from '@nestjs/common';
import { BehaviourEvaluationResult, BehaviourService, CompiledModelSnapshot } from './behaviour.service.js';

export interface EvaluateDto {
  text: string;
}

@Controller('api/behaviour')
export class BehaviourController {
  constructor(private readonly behaviourService: BehaviourService) {}

  @Get('model/latest')
  async getLatestModel(): Promise<CompiledModelSnapshot> {
    return this.behaviourService.getLatestModel();
  }

  @Post('evaluate')
  evaluate(@Body() body: EvaluateDto): BehaviourEvaluationResult {
    return this.behaviourService.evaluateText(body.text || '');
  }
}
