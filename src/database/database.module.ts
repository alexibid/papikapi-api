import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { DRIZZLE_DB, databaseProviders } from './database.provider.js';

@Module({
  imports: [ConfigModule],
  providers: [...databaseProviders],
  exports: [DRIZZLE_DB],
})
export class DatabaseModule {}
