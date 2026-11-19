import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';

export type TrangThai = 'ok' | 'down';

export interface KetQuaKiem {
  status: TrangThai;
  db: 'up' | 'down';
  redis: 'up' | 'down' | 'off';
  uptime_s: number;
  /** Mã HTTP mà controller phải trả. Xem giải thích ở `kiem()`. */
  http: 200 | 503;
}

/**
 * Kiểm sức khoẻ THẬT: có chạm được database không.
 *
 * VÌ SAO CÓ FILE NÀY. `Dockerfile` trước đây thăm dò `/`, và chú thích ngay
 * trên dòng đó tự thừa nhận: "cụm vẫn báo healthy khi MySQL đã chết. Muốn thật
 * thì cần một route health có ping database, hiện chưa có."
 *
 * Một healthcheck chỉ hỏi "tiến trình Node còn sống không" thì luôn trả lời
 * đúng và luôn vô dụng — Node còn sống trong khi database đã chết chính là
 * tình huống cần phát hiện.
 */
@Injectable()
export class HealthService {
  private readonly luc = Date.now();

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * CHỌN CÁI GÌ ĐÁNG 503 LÀ PHẦN KHÓ NHẤT, KHÔNG PHẢI VIẾT ROUTE.
   *
   * Trả 503 là nói với Docker "giết tôi đi". Nên chỉ thứ nào thiếu nó ứng dụng
   * KHÔNG phục vụ được mới được phép 503:
   *
   *   - Database chết → không đọc nổi một sản phẩm nào → 503.
   *   - Redis chết    → cache (`products.service`) và throttler
   *                     (`ThrottlerStorageFailOpen`) đều đã fail-open, API vẫn
   *                     phục vụ, chỉ chậm hơn → 200, ghi `redis: "down"`.
   *
   * Để Redis giết container là tự tay làm hỏng thứ đang còn chạy được.
   */
  async kiem(): Promise<KetQuaKiem> {
    const db = await this.kiemDb();
    const redis = await this.kiemRedis();
    return {
      status: db === 'up' ? 'ok' : 'down',
      db,
      redis,
      uptime_s: Math.round((Date.now() - this.luc) / 1000),
      http: db === 'up' ? 200 : 503,
    };
  }

  private async kiemDb(): Promise<'up' | 'down'> {
    try {
      // `SELECT 1` chứ không đếm bảng nào: route này công khai và bị gọi mỗi 30
      // giây bởi Docker, nên phải rẻ. Nó trả lời đúng một câu — kết nối còn
      // sống và server còn nhận truy vấn không.
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async kiemRedis(): Promise<'up' | 'down' | 'off'> {
    // Không cấu hình Redis thì báo "off", KHÔNG phải "down". Máy cá nhân và CI
    // chạy không Redis; báo động ở đó là báo động giả, mà báo động giả lặp lại
    // thì người ta thôi nhìn cái đèn.
    if (!process.env.REDIS_URL) return 'off';
    // CÓ TRẦN THỜI GIAN. Healthcheck của Docker cắt ở 5 s; nếu lượt kiểm Redis
    // treo thì cả `/health` treo, Docker ghi unhealthy và giết một container mà
    // MySQL vẫn sống — đúng điều ghi ở `kiem()` là phải tránh. Đã xảy ra thật
    // (kiem-suc-khoe-2026-11-11: cả 3 bản api unhealthy khi dừng Redis).
    // `cache.config.ts` đã chặn đường treo đã biết, nhưng còn những kiểu treo
    // client không tự thấy (mạng rớt gói mà không có RST), nên ở đây không trông
    // vào tầng dưới: quá trần thì là `down`.
    let hen: NodeJS.Timeout | undefined;
    const quaTran = new Promise<'down'>((resolve) => {
      hen = setTimeout(() => resolve('down'), HealthService.TRAN_REDIS_MS);
    });
    try {
      return await Promise.race([this.kiemRedisKhongTran(), quaTran]);
    } finally {
      clearTimeout(hen);
    }
  }

  /** Dưới ngưỡng 5 s của healthcheck Docker, chừa chỗ cho `SELECT 1`. */
  private static readonly TRAN_REDIS_MS = 1000;

  private async kiemRedisKhongTran(): Promise<'up' | 'down'> {
    try {
      // Đi qua chính `CACHE_MANAGER` mà ứng dụng dùng thật, thay vì mở thêm một
      // client thứ hai: cái cần biết là "đường cache của ứng dụng có thông
      // không", chứ không phải "có ping được một cổng nào đó không".
      // Khoá RIÊNG mỗi lần kiểm, không dùng chung một khoá cố định. Docker thăm
      // dò mỗi 30 giây, nhưng chỉ cần một người `curl /health` trùng lúc là hai
      // lượt ghi đè nhau và CẢ HAI cùng đọc ra giá trị của người kia rồi cùng
      // báo "down" — một báo động giả không tài nào tái hiện được.
      const gia = `${Date.now()}-${randomUUID()}`;
      const khoa = `health:ping:${gia}`;
      await this.cacheManager.set(khoa, gia, 5000);
      const doc = await this.cacheManager.get<string>(khoa);
      return doc === gia ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
