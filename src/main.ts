import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { TransformInterceptor } from './core/transform.interceptor';
import { HttpExceptionFilter } from './core/http-exception.filter';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api/v1');

  // CORS strict - chỉ allow domain trong env, không dùng '*' (CSRF protection)
  const allowedOrigins = (process.env.SITE_URL || 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Helmet: set các security headers (X-Frame-Options, HSTS, X-Content-Type-Options, ...)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Compression: gzip response, giảm bandwidth ~70%
  app.use(compression());

  // Trust proxy: để ThrottlerGuard đọc IP thật khi chạy sau nginx/load balancer
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  expressApp.set('trust proxy', 1);

  // Static files: cache 7 ngày (CDN-friendly headers)
  app.use(
    '/public',
    express.static('public', {
      maxAge: '7d',
      immutable: true,
    }),
  );

  // Body parser: giảm từ 100mb → 5mb (upload ảnh đã có multer route riêng)
  app.use(
    bodyParser.json({
      limit: '5mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString();
      },
    }),
  );
  app.use(bodyParser.urlencoded({ limit: '5mb', extended: true }));

  // ValidationPipe toàn cục: chặn field thừa + auto transform type
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  
  app.useGlobalFilters(new HttpExceptionFilter());

  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(new TransformInterceptor(reflector));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Backend running on http://localhost:${port}`);
  console.log(`📡 CORS allowed: ${allowedOrigins.join(', ')}`);
}
bootstrap();
