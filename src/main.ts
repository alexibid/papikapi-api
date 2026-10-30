import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  
  const port = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 4505;
  await app.listen(port);
  console.log(`Papikapi API listening on http://localhost:${port}`);
}

void bootstrap();
