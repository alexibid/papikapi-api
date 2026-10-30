import { Global, Module } from '@nestjs/common';
import { ApiConfigService } from './config.service.js';

@Global()
@Module({
  providers: [ApiConfigService],
  exports: [ApiConfigService],
})
export class ConfigModule {}
