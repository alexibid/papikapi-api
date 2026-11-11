import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { BehaviourController } from './behaviour.controller.js';
import { BehaviourService } from './behaviour.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [BehaviourController],
  providers: [BehaviourService],
  exports: [BehaviourService],
})
export class BehaviourModule {}
