import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { GeneratorModule } from './generator/generator.module.js';
import { ManifestsModule } from './manifests/manifests.module.js';
import { ModelsModule } from './models/models.module.js';
import { PipelineModule } from './pipeline/pipeline.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    PipelineModule,
    ModelsModule,
    GeneratorModule,
    ManifestsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
