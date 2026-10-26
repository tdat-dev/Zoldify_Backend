import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import {
  RecommendationsController,
  MyRecommendationsController,
} from '@catalog/recommendations/recommendations.controller';
import { RecommendationsService } from '@catalog/recommendations/recommendations.service';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 9: đầu vào bậy phải ra 400, không ra 500.
 *
 * Controller sản phẩm làm `+id` và `Number(qs.price_min)` rồi đưa thẳng
 * xuống service. Chữ thì thành NaN, và NaN đi vào SQL: `price >= NaN`,
 * `BETWEEN NaN AND ...`, `WHERE id = NaN`. MySQL từ chối, người dùng nhận
 * 500 "Internal server error" cho một lỗi là của chính họ, và log lỗi bị
 * rác bởi thứ không phải sự cố.
 *
 * Service giả ở đây làm đúng điều database làm với NaN: ném lỗi thường (ra
 * 500). Có pipe kiểm đầu vào thì nó không bao giờ được gọi.
 */
describe('Đầu vào bậy ở sản phẩm và gợi ý', () => {
  let app: INestApplication;

  const nemNeuNaN = (...so: unknown[]) => {
    for (const s of so) {
      if (typeof s === 'number' && Number.isNaN(s)) {
        throw new Error('ER_BAD_FIELD_ERROR: Unknown column NaN');
      }
    }
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [
        ProductsController,
        RecommendationsController,
        MyRecommendationsController,
      ],
      providers: [
        {
          provide: ProductsService,
          useValue: {
            findAll: (_p: string, _l: string, qs: Record<string, unknown>) => {
              nemNeuNaN(
                ...['price_min', 'price_max', 'category_id', 'seller_id']
                  .filter((k) => qs[k] !== undefined && qs[k] !== '')
                  .map((k) => Number(qs[k])),
              );
              return { meta: {}, result: [] };
            },
            findOne: (id: number) => {
              nemNeuNaN(id);
              return { id };
            },
          },
        },
        {
          provide: RecommendationsService,
          useValue: {
            relatedToProduct: (id: number) => {
              nemNeuNaN(id);
              return [];
            },
          },
        },
      ],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    // Cùng cấu hình pipe toàn cục với main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const goi = (duong: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(duong);

  it.each([
    '/products?price_min=abc',
    '/products?price_max=12abc',
    '/products?category_id=xyz',
    '/products?seller_id=1.5x',
  ])('GET %s ra 400', async (duong) => {
    expect((await goi(duong)).status).toBe(400);
  });

  it('GET /products/abc ra 400', async () => {
    expect((await goi('/products/abc')).status).toBe(400);
  });

  it('GET /products/abc/related ra 400', async () => {
    expect((await goi('/products/abc/related')).status).toBe(400);
  });

  it.each([
    '/products?price_min=1000&price_max=50000.5&category_id=3&seller_id=7',
    '/products',
    '/products/12',
    '/products/12/related',
  ])('đối chứng: GET %s vẫn 200', async (duong) => {
    expect((await goi(duong)).status).toBe(200);
  });
});
