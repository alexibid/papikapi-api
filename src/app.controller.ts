import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  getRoot(): { message: string; timestamp: string; status: string } {
    return this.appService.getHello();
  }

  @Get('api/v1/hello')
  getHello(): { message: string; timestamp: string; status: string } {
    return this.appService.getHello();
  }
}
