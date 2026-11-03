import * as fs from 'fs';
import * as path from 'path';
import {
  Controller,
  Get,
  INestApplication,
  NotFoundException,
  Post,
  RequestMethod,
  Res,
} from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'express';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { CACHE_BIEN, CacheBien } from './cache-bien';
import { ProductsController } from '@catalog/products/products.controller';
import { ProductsService } from '@catalog/products/products.service';
import { CategoriesController } from '@catalog/categories/categories.controller';
import { CategoriesService } from '@catalog/categories/categories.service';
import { ShopController } from '@catalog/shop/shop.controller';
import { ShopService } from '@catalog/shop/shop.service';

/**
 * Cache ở biên Cloudflare cho các danh sách công khai.
 *
 * Bối cảnh đo được: một VPS, ba bản api. Trang chủ mở ra là gọi
 * `GET /products` + `GET /categories`; 1.000 người cùng cuộn trang chủ là
 * 1.000 lượt vào origin cho CÙNG một kết quả, dù Redis đã giữ sẵn kết quả đó
 * (Redis chỉ bớt được câu SQL, không bớt được lượt đi qua nginx, Caddy, Nest,
 * guard, throttler và serialize JSON). Cho Cloudflare giữ bản sao 30 giây thì
 * mỗi điểm biên chỉ hỏi origin khoảng một lần mỗi 30 giây cho mỗi URL.
 *
 * Bốn điều bài kiểm này giữ, mỗi điều là một cách cache biên làm rò dữ liệu
 * hoặc làm hỏng trang nếu sai:
 *  1. Khách vãng lai (không Authorization) GET danh sách: được cache biên.
 *  2. Có Authorization: `private, no-store`, dù route công khai. Cloudflare
 *     không tách cache theo token; một bản lẫn dữ liệu người này là người
 *     khác đọc ra.
 *  3. Route theo người dùng (giỏ, đơn, hàng của tôi...) không bao giờ có
 *     dấu cache biên: quét MỌI controller, không chỉ ba cái sửa lần này.
 *  4. Không phải GET, có Set-Cookie, lỗi, hay handler đã tự đặt
 *     Cache-Control: không bao giờ thành `public`.
 */

/** Trình duyệt web gửi Origin này; danh sách CORS thật đọc từ SITE_URL. */
const WEB = 'https://zoldify.com';

@Controller('thu-cache')
class ThuCacheController {
  @CacheBien()
  @Post()
  ghi() {
    return { ok: true };
  }

  @CacheBien()
  @Get('cookie')
  coCookie(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', 'phien=abc; HttpOnly');
    return { ok: true };
  }

  @CacheBien()
  @Get('loi')
  loi() {
    throw new NotFoundException('không có');
  }

  @CacheBien()
  @Get('tu-dat')
  tuDat(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    return { ok: true };
  }
}

describe('cache biên Cloudflare cho danh sách công khai', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [
        ProductsController,
        CategoriesController,
        ShopController,
        ThuCacheController,
      ],
      providers: [
        {
          provide: ProductsService,
          useValue: {
            findAll: () => ({ meta: {}, result: [] }),
            findOne: (id: number) => ({ id, status: 'active' }),
          },
        },
        {
          provide: CategoriesService,
          useValue: {
            findAll: () => ({ meta: {}, result: [] }),
            findBySlug: (slug: string) => ({ slug }),
            findOne: (id: number) => ({ id }),
          },
        },
        {
          provide: ShopService,
          useValue: {
            getShopInfo: (id: number) => ({ id }),
            getShopProducts: () => ({ meta: {}, result: [] }),
          },
        },
      ],
    }).compile();
    app = mod.createNestApplication({ logger: false });
    // Cùng cấu hình CORS với main.ts: danh sách origin + credentials.
    app.enableCors({ origin: [WEB], credentials: true });
    await app.init();
  });

  afterAll(() => app.close());

  const congKhai = [
    '/products?current=1&pageSize=20',
    '/categories',
    '/categories/slug/dien-thoai',
    '/categories/3',
    '/shop/5',
    '/shop/5/products?page=1',
  ];

  it.each(congKhai)('khách vãng lai GET %s: biên được cache', async (url) => {
    const r = await request(app.getHttpServer()).get(url).set('Origin', WEB);
    expect(r.status).toBe(200);
    // Trình duyệt: hỏi lại mỗi lần (rẻ, vì Cloudflare trả 304/HIT).
    expect(r.headers['cache-control']).toBe('public, max-age=0');
    // Cloudflare đọc CDN-Cache-Control TRƯỚC Cache-Control. Không dùng
    // s-maxage: theo tài liệu Cloudflare, s-maxage tắt luôn
    // stale-while-revalidate và stale-if-error.
    expect(r.headers['cdn-cache-control']).toMatch(
      /^max-age=\d+, stale-while-revalidate=\d+, stale-if-error=\d+$/,
    );
    expect(r.headers['cdn-cache-control']).not.toContain('s-maxage');
  });

  it('danh sách sản phẩm: biên giữ 30 giây', async () => {
    const r = await request(app.getHttpServer()).get('/products');
    expect(r.headers['cdn-cache-control']).toContain('max-age=30,');
  });

  it('bản cache dùng được cho MỌI origin: ACAO là *, không có credentials', async () => {
    // Bản đầu tiên vào cache có thể đến từ app di động (không gửi Origin)
    // hoặc từ admin.zoldify.com. Cloudflare không tách cache theo Origin,
    // nên nếu ACAO phản chiếu origin của người hỏi đầu, mọi trang web khác
    // nhận bản đó đều bị trình duyệt chặn CORS.
    const khongOrigin = await request(app.getHttpServer()).get('/products');
    expect(khongOrigin.headers['access-control-allow-origin']).toBe('*');
    const coOrigin = await request(app.getHttpServer())
      .get('/products')
      .set('Origin', WEB);
    expect(coOrigin.headers['access-control-allow-origin']).toBe('*');
    expect(
      coOrigin.headers['access-control-allow-credentials'],
    ).toBeUndefined();
    expect(coOrigin.headers['vary'] ?? '').not.toMatch(/origin/i);
  });

  it('HEAD cũng được cache như GET', async () => {
    const r = await request(app.getHttpServer()).head('/products');
    expect(r.headers['cdn-cache-control']).toBeDefined();
  });

  it.each(congKhai)(
    'có Authorization GET %s: private, no-store',
    async (url) => {
      const r = await request(app.getHttpServer())
        .get(url)
        .set('Origin', WEB)
        .set('Authorization', 'Bearer gi-cung-duoc');
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['cdn-cache-control']).toBeUndefined();
      // CORS giữ nguyên luật chặt của main.ts cho request có danh tính.
      expect(r.headers['access-control-allow-origin']).toBe(WEB);
    },
  );

  it('chi tiết sản phẩm KHÔNG cache biên: lượt xem phải đếm từng lượt', async () => {
    // findOne đếm view_count trên Redis ở mỗi lượt gọi (sửa 26/10: đếm cả
    // lượt trúng cache Redis, vì trước đó 3 lượt xem đếm được 1 và
    // `most_viewed` sắp theo số lần cache hết hạn). Cache ở biên thì lượt
    // trúng biên không tới origin, và lỗi đó quay lại y nguyên.
    const r = await request(app.getHttpServer()).get('/products/7');
    expect(r.status).toBe(200);
    expect(r.headers['cdn-cache-control']).toBeUndefined();
    expect(r.headers['cache-control'] ?? '').not.toContain('public');
  });

  it('POST mang nhầm dấu cache: không bao giờ public', async () => {
    const r = await request(app.getHttpServer()).post('/thu-cache');
    expect(r.headers['cdn-cache-control']).toBeUndefined();
    expect(r.headers['cache-control'] ?? '').not.toContain('public');
  });

  it('có Set-Cookie: private, no-store', async () => {
    const r = await request(app.getHttpServer()).get('/thu-cache/cookie');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['cdn-cache-control']).toBeUndefined();
  });

  it('lỗi (404): không gắn header cache biên', async () => {
    const r = await request(app.getHttpServer()).get('/thu-cache/loi');
    expect(r.status).toBe(404);
    expect(r.headers['cdn-cache-control']).toBeUndefined();
    expect(r.headers['cache-control'] ?? '').not.toContain('public');
  });

  it('handler tự đặt Cache-Control: giữ nguyên, không ghi đè', async () => {
    const r = await request(app.getHttpServer()).get('/thu-cache/tu-dat');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['cdn-cache-control']).toBeUndefined();
  });
});

/**
 * Quét MỌI controller trong src: route nào mang dấu cache biên phải nằm
 * trong danh sách dưới, là GET, và là @Public(). Thêm route vào đây là một
 * quyết định có chủ đích (người review thấy trong diff), không phải chuyện
 * dán nhầm decorator lên `GET /cart`.
 */
describe('chỉ đúng các route công khai đã chọn mang dấu cache biên', () => {
  const DUOC_PHEP = [
    'CategoriesController.findAll',
    'CategoriesController.findBySlug',
    'CategoriesController.findOne',
    'ProductsController.findAll',
    'ShopController.getProducts',
    'ShopController.getShop',
  ].sort();

  function napMoiController(): Array<new (...a: never[]) => unknown> {
    const goc = path.resolve(__dirname, '..');
    const ketQua: Array<new (...a: never[]) => unknown> = [];
    const di = (thuMuc: string) => {
      for (const ten of fs.readdirSync(thuMuc)) {
        const p = path.join(thuMuc, ten);
        if (fs.statSync(p).isDirectory()) di(p);
        else if (ten.endsWith('.controller.ts')) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const mod = require(p) as Record<string, unknown>;
          for (const v of Object.values(mod)) {
            if (typeof v === 'function' && /Controller$/.test(v.name)) {
              ketQua.push(v as new (...a: never[]) => unknown);
            }
          }
        }
      }
    };
    di(goc);
    return ketQua;
  }

  const coDau: Array<{ ten: string; fn: object }> = [];
  for (const C of napMoiController()) {
    const proto = C.prototype as Record<string, unknown>;
    for (const m of Object.getOwnPropertyNames(proto)) {
      const fn = proto[m];
      if (m === 'constructor' || typeof fn !== 'function') continue;
      if (Reflect.getMetadata(CACHE_BIEN, fn) !== undefined) {
        coDau.push({ ten: `${C.name}.${m}`, fn });
      }
    }
  }

  it('đúng danh sách, không thừa không thiếu', () => {
    expect(coDau.map((x) => x.ten).sort()).toEqual(DUOC_PHEP);
  });

  it('mọi route mang dấu đều là GET và @Public()', () => {
    for (const { ten, fn } of coDau) {
      expect([ten, Reflect.getMetadata(METHOD_METADATA, fn)]).toEqual([
        ten,
        RequestMethod.GET,
      ]);
      expect([ten, Reflect.getMetadata(IS_PUBLIC_KEY, fn)]).toEqual([
        ten,
        true,
      ]);
    }
  });
});
