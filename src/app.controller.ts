import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { AppService } from './app.service';

// Giữ ở gốc, không prefix không version — dùng để kiểm tra server còn sống.
@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
