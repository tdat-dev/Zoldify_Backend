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
  private readonly redis: RedisDem | null;
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
    const url = process.env.REDIS_URL;
    if (!url) {
      this.redis = null;
      return;
    }
    // Cùng khuôn với ProductsService: không xếp hàng lệnh khi mất kết nối (lệnh
    // hỏng ngay để rơi về RAM), và có listener 'error' để lỗi kết nối không
    // thành lỗi chưa bắt giết cả tiến trình.
    const client = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    client.on('error', () => undefined);
    this.redis = client;
  }

  /** true nếu người dùng còn trong hạn mức (và lần này đã được tính). */
  async conTrongHan(userId: number): Promise<boolean> {
    const khoa = `${this.tienTo}:${userId}`;
    if (this.redis) {
      try {
        await this.redis.set(khoa, 0, 'PX', this.cuaSoMs, 'NX');
        const n = await this.redis.incr(khoa);
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
