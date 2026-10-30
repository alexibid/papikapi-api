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
  findOneLegacy(@Query('name') name: string): ModelDetailInfo {
    return this.modelsService.findOne(name);
  }

  @Get('api/creator/sheet')
  getSheetLegacy(@Query('name') name: string, @Res() res: Response): void {
    this.getSheet(name, res);
  }

  @Post('api/creator/delete')
  @HttpCode(HttpStatus.OK)
  removeLegacy(@Body('name') name: string): { success: boolean; name: string } {
    return this.modelsService.deleteModel(name);
  }

  @Get('api/v1/models/:name')
  findOne(@Param('name') name: string): ModelDetailInfo {
    return this.modelsService.findOne(name);
  }

  @Get('api/v1/models/:name/sheet')
  getSheet(@Param('name') name: string, @Res() res: Response): void {
    const sheet = this.modelsService.getSheet(name);
    res.setHeader('Content-Type', sheet.mime);
    res.setHeader('Content-Length', sheet.buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sheet.buffer);
  }

  @Get('api/v1/models/:name/mesh')
  getMesh(@Param('name') name: string, @Res() res: Response): void {
    const meshPath = this.modelsService.getMeshPath(name);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = createReadStream(meshPath);
    stream.pipe(res);
  }

  @Delete('api/v1/models/:name')
  remove(@Param('name') name: string): { success: boolean; name: string } {
    return this.modelsService.deleteModel(name);
  }
}
