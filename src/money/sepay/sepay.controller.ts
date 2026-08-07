import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
} from '@nestjs/common';
import { SepayService } from './sepay.service';
import { Public } from '@common/decorators/public.decorator';

@Controller('api/sepay-webhook')
export class SepayController {
  constructor(private readonly sepayService: SepayService) {}

  /**
   * Sepay gửi webhook đến endpoint này
   * Public — không cần JWT vì Sepay không biết token của user
   * Xác thực bằng HMAC signature thay vì JWT
   */
  @Public()
  @Post()
  @HttpCode(200)  // Luôn trả 200 để Sepay không gửi lại
  async handleWebhook(
    @Headers('x-signature') signature: string,
    @Req() req: any,
  ) {
    // Bước 1: Lấy raw body string
    // Quan trọng: phải xác thực trên raw body, không phải JSON đã parse
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // Bước 2: Xác thực HMAC signature
    if (!signature || !this.sepayService.verifySignature(signature, rawBody)) {
      // Chữ ký không hợp lệ → vẫn trả 200 để Sepay không spam
      return { received: true, error: 'Invalid signature' };
    }

    // Bước 3: Xử lý webhook
    return this.sepayService.handleWebhook(req.body);
  }
}