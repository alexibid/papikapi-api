import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MANIFEST_REPOSITORY } from './domain/manifest.repository.interface.js';
import { DrizzleManifestRepository } from './infrastructure/drizzle-manifest.repository.js';
import { ManifestsController } from './manifests.controller.js';
import { ManifestsService } from './manifests.service.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [ManifestsController],
  providers: [
    ManifestsService,
    {
      provide: MANIFEST_REPOSITORY,
      useClass: DrizzleManifestRepository,
    },
  ],
  exports: [ManifestsService, MANIFEST_REPOSITORY],
})
export class ManifestsModule {}
