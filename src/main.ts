import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ApiConfigService } from './config/config.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();

  const configService = app.get(ApiConfigService);
  app.useStaticAssets(configService.modelsDir, {
    prefix: '/models/',
  });

  const config = new DocumentBuilder()
    .setTitle('Papikapi API')
    .setDescription('Generative 3D Papercraft Service & Model Catalogue API')
    .setVersion('1.0')
    .addTag('health')
    .addTag('pipeline')
    .addTag('models')
    .addTag('generator')
    .addTag('manifests')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 4505;
  await app.listen(port);
  console.log(`Papikapi API listening on http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/api/docs`);
}

void bootstrap();
