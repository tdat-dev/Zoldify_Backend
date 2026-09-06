import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * `/health` — nằm ở GỐC domain, không prefix không version.
 *
 * Docker thăm dò đường dẫn này (xem `HEALTHCHECK` trong `Dockerfile`), nên nó
 * phải cố định và không đi qua `/api/v1`. `routing.config.ts` loại nó khỏi
 * prefix, cạnh `/` và ba route sitemap.
 *
 * `maintenance.guard.ts` vốn đã chừa sẵn mọi đường dẫn kết thúc bằng `/health`
 * khỏi chế độ bảo trì — đúng cái cần: bật bảo trì mà healthcheck cũng chết thì
 * Docker sẽ giết container đang cố tình được giữ im.
 */
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  // Không đưa vào hợp đồng API: đây là đường cho Docker và người trực, không
  // phải cho web hay app. Đưa vào openapi là mời người ngoài dò trạng thái
  // database của mình.
  @ApiExcludeEndpoint()
  @Get('health')
  async kiem(@Res() res: Response): Promise<void> {
    const kq = await this.healthService.kiem();
    // Trả thẳng qua `res` chứ không để interceptor bọc: Docker đọc MÃ HTTP, và
    // mã đó phải là 503 khi database chết. Bọc vào phong bì `{statusCode, data}`
    // thì mã ngoài luôn là 200 và healthcheck lại vô dụng đúng như bản cũ.
    const { http, ...than } = kq;
    res.status(http).json(than);
  }
}
