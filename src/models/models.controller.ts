import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import {
  CatalogueModelEntry,
  ModelDetailInfo,
  ModelsService,
} from './models.service.js';

@Controller()
export class ModelsController {
  constructor(@Inject(ModelsService) private readonly modelsService: ModelsService) {}

  @Get(['api/v1/models', 'api/catalogue'])
  findAll(): readonly CatalogueModelEntry[] {
    return this.modelsService.findAll();
  }

  @Post('api/v1/models/sync')
  @HttpCode(HttpStatus.OK)
  sync(): { success: boolean; count: number; models: readonly CatalogueModelEntry[] } {
    const models = this.modelsService.syncCatalogue();
    return {
      success: true,
      count: models.length,
      models,
    };
  }

  @Get(['api/catalogue/sync', 'api/creator/sync'])
  @Post(['api/catalogue/sync', 'api/creator/sync'])
  @HttpCode(HttpStatus.OK)
  syncLegacy(): { success: boolean; count: number; models: readonly CatalogueModelEntry[] } {
    return this.sync();
  }

  @Get('api/creator/info')
  findOneLegacy(@Query('id') id: string): ModelDetailInfo {
    return this.modelsService.findOne(id);
  }

  @Get('api/creator/sheet')
  getSheetLegacy(@Query('id') id: string, @Res() res: Response): void {
    this.getSheet(id, res);
  }

  @Post('api/creator/delete')
  @HttpCode(HttpStatus.OK)
  removeLegacy(@Body('id') id: string): { success: boolean; id: string } {
    return this.modelsService.deleteModel(id);
  }

  @Get('api/v1/models/:id')
  findOne(@Param('id') id: string): ModelDetailInfo {
    return this.modelsService.findOne(id);
  }

  @Get('api/v1/models/:id/sheet')
  getSheet(@Param('id') id: string, @Res() res: Response): void {
    const sheet = this.modelsService.getSheet(id);
    res.setHeader('Content-Type', sheet.mime);
    res.setHeader('Content-Length', sheet.buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sheet.buffer);
  }

  @Get('api/v1/models/:id/mesh')
  getMesh(@Param('id') id: string, @Res() res: Response): void {
    const meshPath = this.modelsService.getMeshPath(id);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = createReadStream(meshPath);
    stream.pipe(res);
  }

  @Get(['models/:id/assembly.json', 'figures/:id/assembly.json', 'api/v1/models/:id/assembly'])
  getAssembly(@Param('id') id: string, @Res() res: Response): void {
    const plan = this.modelsService.getAssemblyPlan(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(plan);
  }

  @Delete('api/v1/models/:id')
  remove(@Param('id') id: string): { success: boolean; id: string } {
    return this.modelsService.deleteModel(id);
  }
}
