import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { ManifestDetail, ManifestOverview, ManifestPage } from './domain/manifest.types.js';
import { estimateOf, listQueryOf, type RawListQuery } from './manifest-query.js';
import { ManifestsService } from './manifests.service.js';

@ApiTags('manifests')
@Controller('api/v1/manifests')
export class ManifestsController {
  constructor(@Inject(ManifestsService) private readonly manifestsService: ManifestsService) {}

  @Get()
  @ApiOperation({ summary: 'Figures with their status, time, cost and dates, searchable and sortable' })
  @ApiQuery({ name: 'query', required: false, description: 'Code, subject, name (pt or en) or prompt text' })
  @ApiQuery({ name: 'status', required: false, enum: ['DONE', 'FAILED', 'IN_PROGRESS', 'PENDING'] })
  @ApiQuery({ name: 'from', required: false, description: 'Updated on or after this day (YYYY-MM-DD)' })
  @ApiQuery({ name: 'to', required: false, description: 'Updated on or before this day (YYYY-MM-DD)' })
  @ApiQuery({ name: 'sort', required: false, enum: ['name', 'created', 'updated', 'cost', 'seconds'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Default 20, at most 100' })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  list(@Query() query: RawListQuery): ManifestPage {
    return this.manifestsService.list(listQueryOf(query));
  }

  @Get('summary')
  @ApiOperation({ summary: 'Average time and cost per step and per figure, an estimate for N figures, spend by day' })
  @ApiQuery({ name: 'figures', required: false, type: Number, description: 'Figures to estimate (default 1)' })
  summary(@Query('figures') figures?: string): ManifestOverview {
    return this.manifestsService.overview(estimateOf(figures));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full manifest of one figure: every step, every run, totals, dates and files' })
  detail(@Param('id') id: string): ManifestDetail {
    return this.manifestsService.detail(id);
  }
}
