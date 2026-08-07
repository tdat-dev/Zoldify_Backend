import { DocumentBuilder } from '@nestjs/swagger';

/**
 * Hợp đồng API của Zoldify.
 *
 * Web và app mobile đều sinh client từ file openapi.json xuất ra từ đây,
 * nên mọi thay đổi ở tầng DTO sẽ tự động lan sang cả hai.
 *
 * Lưu ý về v1: một khi app đã lên store thì v1 bị đóng băng. Chỉ được
 * THÊM field tuỳ chọn. Cấm đổi tên, cấm xoá, cấm đổi kiểu — vì app cũ
 * trên máy người dùng vẫn gọi vào đây hàng tháng sau đó.
 */
export const swaggerConfig = new DocumentBuilder()
  .setTitle('Zoldify API')
  .setDescription(
    'API của sàn mua bán đồ cũ Zoldify. Web (Next.js) và app (React Native) ' +
      'dùng chung hợp đồng này.',
  )
  .setVersion('1.0')
  .addBearerAuth(
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    'access-token',
  )
  .addServer(process.env.API_PUBLIC_URL || 'http://localhost:3000', 'Server')
  .build();
