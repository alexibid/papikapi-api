import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, Observable } from 'rxjs';
import {
  GenerateAlternativesPayload,
  GeneratorService,
  SynthesizePayload,
} from './generator.service.js';
import { ProgressEvent, ProgressService } from './progress/progress.service.js';

@Controller()
export class GeneratorController {
  constructor(
    @Inject(GeneratorService) private readonly generatorService: GeneratorService,
    @Inject(ProgressService) private readonly progressService: ProgressService,
  ) {}

  // --- Modern v1 REST Endpoints ---

  @Post('api/v1/generator/alternatives')
  @HttpCode(HttpStatus.OK)
  async generateAlternativesV1(@Body() payload: GenerateAlternativesPayload) {
    return this.generatorService.generateAlternatives(payload);
  }

  @Post('api/v1/generator/synthesize')
  @HttpCode(HttpStatus.OK)
  async synthesizeV1(@Body() payload: SynthesizePayload) {
    return this.generatorService.synthesize(payload);
  }

  @Get('api/v1/generator/progress/:name/latest')
  getLatestProgress(@Param('name') name: string) {
    const latest = this.progressService.getCurrentEvent(name);
    return latest || { model: name, state: 'idle', message: 'No active job' };
  }

  @Sse('api/v1/generator/progress/:name')
  streamProgressV1(@Param('name') name: string): Observable<{ data: ProgressEvent }> {
    return this.progressService.getStream(name).pipe(
      map((event) => ({ data: event })),
    );
  }

  // --- Legacy Endpoints (Backwards Compatibility) ---

  @Post('api/creator/generate')
  @HttpCode(HttpStatus.OK)
  async generateLegacy(@Body() payload: GenerateAlternativesPayload) {
    return this.generatorService.generateAlternatives(payload);
  }

  @Post('api/creator/pick')
  @HttpCode(HttpStatus.OK)
  async pickLegacy(@Body() payload: SynthesizePayload) {
    return this.generatorService.synthesize(payload);
  }

  @Get('api/creator/progress')
  streamProgressLegacy(
    @Query('name') name: string,
    @Res() res: Response,
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const subscription = this.progressService.getStream(name || '').subscribe({
      next: (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      error: (err) => {
        res.write(`data: ${JSON.stringify({ state: 'failed', message: err.message })}\n\n`);
      },
    });

    res.on('close', () => {
      subscription.unsubscribe();
    });
  }
}
