import { DataSource } from 'typeorm';
import type { Cache } from '@nestjs/cache-manager';
import { HealthService, TrangThai } from './health.service';

/**
 * `/health` — bài kiểm viết TRƯỚC.
 *
 * VÌ SAO CẦN ROUTE NÀY.
 *
 * `Dockerfile` đang thăm dò `/`, và chú thích ngay trên dòng đó tự thừa nhận:
 *
 *   "nên cụm vẫn báo healthy khi MySQL đã chết. Muốn thật thì cần một route
 *    health có ping database, hiện chưa có."
 *
 * Một healthcheck chỉ hỏi "tiến trình Node còn sống không" thì luôn trả lời
 * đúng và luôn vô dụng: Node còn sống trong khi database đã chết là đúng cái
 * tình huống cần phát hiện.
 *
 * ĐIỀU KHÓ NHẤT Ở ĐÂY KHÔNG PHẢI VIẾT ROUTE, MÀ LÀ CHỌN CÁI GÌ ĐÁNG 503.
 *
 * Trả 503 nghĩa là nói với Docker "giết tôi đi". Nên chỉ những thứ mà thiếu nó
 * ứng dụng KHÔNG phục vụ được mới được phép 503:
 *
 *   - Database chết  → không đọc nổi một sản phẩm nào → **503**.
 *   - Redis chết     → cache và throttler đều đã fail-open, API vẫn phục vụ
 *                      bình thường, chỉ chậm hơn → **200**, ghi `redis: down`.
 *
 * Để Redis giết container là tự tay làm hỏng thứ đang còn chạy được. Ba bài
 * kiểm dưới đây khoá đúng ranh giới đó lại.
 */
describe('HealthService', () => {
  // Cache giả phải VỌNG LẠI đúng thứ vừa ghi. Bản đầu trả cứng số 1, và bài
  // kiểm đỏ — hoá ra nó bắt đúng: service so giá trị đọc ra với giá trị vừa
  // ghi, nên một cache nuốt lặng lẽ lượt ghi sẽ bị phát hiện.
  const kho = new Map<string, unknown>();
  const cacheOk = {
    set: (k: string, v: unknown) => {
      kho.set(k, v);
      return Promise.resolve(undefined);
    },
    get: (k: string) => Promise.resolve(kho.get(k)),
  } as unknown as Cache;

  const cacheHong = {
    set: () => Promise.reject(new Error('Redis toang')),
    get: () => Promise.reject(new Error('Redis toang')),
  } as unknown as Cache;

  const dsOk = {
    query: () => Promise.resolve([{ '1': 1 }]),
  } as unknown as DataSource;

  const dsHong = {
    query: () => Promise.reject(new Error('MySQL toang')),
  } as unknown as DataSource;

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it('mọi thứ sống → ok, và mã 200', async () => {
    process.env.REDIS_URL = 'redis://x';
    const kq = await new HealthService(dsOk, cacheOk).kiem();
    expect(kq.status).toBe<TrangThai>('ok');
    expect(kq.db).toBe('up');
    expect(kq.redis).toBe('up');
    expect(kq.http).toBe(200);
    expect(typeof kq.uptime_s).toBe('number');
  });

  it('DATABASE chết → down, và mã 503', async () => {
    // Đây là lý do route này tồn tại. Trả 200 ở đây là lặp lại đúng khuyết tật
    // của healthcheck cũ: báo khoẻ trong khi không phục vụ được ai.
    process.env.REDIS_URL = 'redis://x';
    const kq = await new HealthService(dsHong, cacheOk).kiem();
    expect(kq.status).toBe<TrangThai>('down');
    expect(kq.db).toBe('down');
    expect(kq.http).toBe(503);
  });

  it('REDIS chết → VẪN ok và mã 200, chỉ ghi redis=down', async () => {
    // Cache (products.service) và throttler (ThrottlerStorageFailOpen) đều đã
    // fail-open. API vẫn phục vụ, chỉ chậm hơn. Để Redis giết container là tự
    // làm hỏng thứ đang còn chạy được.
    process.env.REDIS_URL = 'redis://x';
    const kq = await new HealthService(dsOk, cacheHong).kiem();
    expect(kq.status).toBe<TrangThai>('ok');
    expect(kq.db).toBe('up');
    expect(kq.redis).toBe('down');
    expect(kq.http).toBe(200);
  });

  it('không cấu hình Redis → redis=off, không phải down', async () => {
    // Máy cá nhân và CI chạy không Redis. Báo "down" ở đó là báo động giả, và
    // báo động giả lặp lại thì người ta thôi nhìn cái đèn.
    const kq = await new HealthService(dsOk, cacheOk).kiem();
    expect(kq.redis).toBe('off');
    expect(kq.status).toBe<TrangThai>('ok');
    expect(kq.http).toBe(200);
  });

  it('cả hai chết thì DATABASE quyết định mã trả về', async () => {
    process.env.REDIS_URL = 'redis://x';
    const kq = await new HealthService(dsHong, cacheHong).kiem();
    expect(kq.http).toBe(503);
    expect(kq.db).toBe('down');
    expect(kq.redis).toBe('down');
  });
});
