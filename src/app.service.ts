import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): { message: string; timestamp: string; status: string } {
    return {
      message: 'Hello World from Papikapi API!',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
