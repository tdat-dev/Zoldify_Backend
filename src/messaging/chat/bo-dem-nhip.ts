import Redis from 'ioredis';

/** Phần của ioredis mà bộ đếm dùng; tách ra để bài kiểm đưa client giả vào. */
export interface RedisDem {
  set(
    key: string,
    value: number,
    px: 'PX',
    ms: number,
    nx: 'NX',
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
}

/**
 * Đếm số lần một NGƯỜI DÙNG làm gì đó trong một cửa sổ thời gian, chung cho
 * mọi socket và mọi bản api.
 *
 * VÌ SAO KHÔNG ĐẾM TRONG client.data NHƯ TRƯỚC.
 *
 * Bộ đếm cũ nằm trên từng socket: ngắt rồi nối lại là về 0, mở N tab là N lần
 * hạn mức, và chạy ba bản api sau load balancer thì mỗi bản một bộ đếm. Tức
 * giới hạn chỉ chặn được đúng người không cố né nó.
 *
 * CÁCH ĐẾM TRÊN REDIS: SET khoá 0 PX <cửa sổ> NX, rồi INCR. Không dùng
 * "INCR rồi EXPIRE nếu bằng 1": tiến trình chết giữa hai lệnh là khoá sống mãi
 * không hạn, người đó bị chặn vĩnh viễn. SET ... NX gắn hạn ngay lúc tạo khoá,
 * INCR giữ nguyên hạn đó.
 *
 * KHÔNG CÓ REDIS (máy dev) HOẶC REDIS LỖI: rơi về bộ đếm trong RAM, vẫn theo
 * người dùng chứ không theo socket. Không chặn ai vì Redis hỏng (một tính năng
 * phụ không được làm ngừng chat), nhưng cũng không mở toang: một tiến trình vẫn
 * đếm đúng phần của nó.
 */
export class BoDemNhip {
  private redis: RedisDem | null;
  private redisUrl: string | null = null;
  private tuTao: Redis | null = null;
  private readonly trongRam = new Map<string, number[]>();

  constructor(
    private readonly tienTo: string,
    private readonly toiDa: number,
    private readonly cuaSoMs: number,
    redis?: RedisDem | null,
  ) {
    if (redis !== undefined) {
      this.redis = redis;
      return;
    }
    // KHÔNG nối Redis ngay lúc dựng. Bản đầu nối luôn trong constructor, và
    // ChatGateway dựng bộ đếm này cho mọi instance: mỗi bài kiểm `new ChatGateway`
    // mở một kết nối không ai đóng. Đo 26/10 trên nhánh gộp: có REDIS_URL thì jest
    // chạy xong 507/507 bài trong 114 giây rồi treo tới hết hạn 10 phút của
    // nghiem-thu ("Jest did not exit"); không có REDIS_URL thì thoát sau 128 giây.
    // Giờ chỉ nối ở lần đếm đầu tiên.
    this.redis = null;
    this.redisUrl = process.env.REDIS_URL || null;
  }

  private layRedis(): RedisDem | null {
    if (this.redis || !this.redisUrl) return this.redis;
    // Cùng khuôn với ProductsService: không xếp hàng lệnh khi mất kết nối (lệnh
    // hỏng ngay để rơi về RAM), và có listener 'error' để lỗi kết nối không
    // thành lỗi chưa bắt giết cả tiến trình.
    const client = new Redis(this.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    client.on('error', () => undefined);
    // Bộ đếm nhịp không phải lý do để tiến trình còn sống: unref socket (và
    // socket mới sau mỗi lần nối lại) để kết nối này không giữ tiến trình lúc
    // tắt, cũng không giữ jest sau khi chạy xong.
    client.on('connect', () => {
      (
        client as unknown as { stream?: { unref?: () => void } }
      ).stream?.unref?.();
    });
    this.tuTao = client;
    this.redis = client;
    return client;
  }

  /** Đóng kết nối Redis do chính bộ đếm mở (nếu có). Gọi lúc module tắt. */
  async dong(): Promise<void> {
    const c = this.tuTao;
    this.tuTao = null;
    if (c) {
      this.redis = null;
      await c.quit().catch(() => undefined);
    }
  }

  /** true nếu người dùng còn trong hạn mức (và lần này đã được tính). */
  async conTrongHan(userId: number): Promise<boolean> {
    const khoa = `${this.tienTo}:${userId}`;
    const redis = this.layRedis();
    if (redis) {
      try {
        await redis.set(khoa, 0, 'PX', this.cuaSoMs, 'NX');
        const n = await redis.incr(khoa);
        return n <= this.toiDa;
      } catch {
        // Rơi xuống bộ đếm trong RAM.
      }
    }
    const bayGio = Date.now();
    const gan = (this.trongRam.get(khoa) ?? []).filter(
      (t) => bayGio - t < this.cuaSoMs,
    );
    if (gan.length >= this.toiDa) {
      this.trongRam.set(khoa, gan);
      return false;
    }
    gan.push(bayGio);
    this.trongRam.set(khoa, gan);
    return true;
  }
}
