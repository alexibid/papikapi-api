import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ManifestsService } from './manifests.service.js';

@ApiTags('manifests')
@Controller('api/v1/manifests')
export class ManifestsController {
  constructor(
    @Inject(ManifestsService)
    private readonly manifestsService: ManifestsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List model manifests with search and filters' })
  @ApiQuery({ name: 'query', required: false, description: 'Search term in prompt' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  findAll(
    @Query('query') query?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.manifestsService.findAll({
      query,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('analytics/times')
  @ApiOperation({ summary: 'Get stage timing analytics and aggregates across all models' })
  getAnalyticsTimes() {
    return this.manifestsService.getAnalyticsTimes();
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync and import all manifests from models directory into database' })
  syncFromDisk() {
    return this.manifestsService.syncFromDisk();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full manifest by model ID' })
  findOne(@Param('id') id: string) {
    return this.manifestsService.findOne(id);
  }

  @Get(':id/telemetry')
  @ApiOperation({ summary: 'Get detailed timing breakdown and metrics for a specific model' })
  getTelemetry(@Param('id') id: string) {
    return this.manifestsService.getTelemetry(id);
  }
}
