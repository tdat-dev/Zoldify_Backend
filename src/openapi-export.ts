import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from './app.module';
import { configureRouting } from './core/routing.config';
import { swaggerConfig } from './core/swagger.config';

/**
 * Xuất hợp đồng API ra openapi.json.
 *
 * Web và app chạy `npm run gen:api` đọc file này để sinh client có kiểu
 * đầy đủ, nên nó phải được commit vào repo và CI phải kiểm là nó không
 * lệch với code.
 *
 * Chạy ở chế độ preview: Nest dựng cây module và bản đồ route nhưng KHÔNG
 * khởi tạo provider, nhờ vậy không cần MySQL đang chạy. Quan trọng cho CI.
 */
async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });

  configureRouting(app);

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  const pathCount = Object.keys(document.paths ?? {}).length;
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length;

  if (pathCount === 0) {
    throw new Error(
      'openapi.json không có route nào. Nhiều khả năng chế độ preview không ' +
        'dựng được bản đồ route — bỏ preview và chạy lại khi MySQL đang bật.',
    );
  }

  writeFileSync('openapi.json', JSON.stringify(document, null, 2), 'utf8');
  console.log(
    `Đã ghi openapi.json — ${pathCount} route, ${schemaCount} schema.`,
  );

  await app.close();
}

exportOpenApi().catch((err: Error) => {
  console.error('Xuất openapi.json thất bại:', err.message);
  process.exit(1);
});
