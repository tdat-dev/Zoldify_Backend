import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import {
  HangDoiViecNen,
  JOB_BAO_HANG_MOI,
  TEN_HANG_DOI,
  urlHangDoi,
} from './hang-doi';

/**
 * BullMQ phải đi vào Redis RIÊNG (QUEUE_REDIS_URL), không vào Redis cache.
 *
 * Redis cache chạy `allkeys-lru`: đầy thì đuổi khoá ít dùng nhất, và khoá job
 * / lịch lặp của BullMQ (đọc mỗi giờ một lần) là ứng viên số một. docker-
 * compose.yml dựng thêm `redis-queue` (noeviction) cho hàng đợi; bài này gác
 * phía mã: đọc đúng biến, và RƠI VỀ REDIS_URL khi biến mới chưa được đặt, để
 * máy nào chưa cập nhật .env (dev, staging trước lần deploy kế) vẫn chạy y
 * như cũ.
 */
describe('urlHangDoi: chọn Redis cho BullMQ', () => {
  const cu = { q: process.env.QUEUE_REDIS_URL, r: process.env.REDIS_URL };
  afterEach(() => {
    process.env.QUEUE_REDIS_URL = cu.q;
    process.env.REDIS_URL = cu.r;
    if (cu.q === undefined) delete process.env.QUEUE_REDIS_URL;
    if (cu.r === undefined) delete process.env.REDIS_URL;
  });

  it('ưu tiên QUEUE_REDIS_URL', () => {
    process.env.QUEUE_REDIS_URL = 'redis://hang-doi:6379';
    process.env.REDIS_URL = 'redis://cache:6379';
    expect(urlHangDoi()).toBe('redis://hang-doi:6379');
  });

  it('rơi về REDIS_URL khi QUEUE_REDIS_URL chưa đặt hoặc rỗng', () => {
    process.env.REDIS_URL = 'redis://cache:6379';
    delete process.env.QUEUE_REDIS_URL;
    expect(urlHangDoi()).toBe('redis://cache:6379');
    // Compose viết `QUEUE_REDIS_URL: ${...:-}` thì biến tồn tại mà rỗng.
    process.env.QUEUE_REDIS_URL = '';
    expect(urlHangDoi()).toBe('redis://cache:6379');
  });

  it('không có cả hai thì trả undefined (bên xếp fail-open, worker ném)', () => {
    delete process.env.QUEUE_REDIS_URL;
    delete process.env.REDIS_URL;
    expect(urlHangDoi()).toBeUndefined();
  });
});

// Phần dưới cần Redis thật. Chỉ chạy khi có TEST_REDIS_URL (CI và nghiệm thu
// đều đặt), để `npm test` trên máy không có Redis không đỏ vì lý do ngoài mã.
const REDIS_THAT = process.env.TEST_REDIS_URL;
(REDIS_THAT ? describe : describe.skip)(
  'HangDoiViecNen xếp job vào đúng Redis hàng đợi',
  () => {
    const cu = { q: process.env.QUEUE_REDIS_URL, r: process.env.REDIS_URL };
    let conn: IORedis;
    let q: Queue;
    const daXep: string[] = [];

    beforeAll(() => {
      conn = new IORedis(REDIS_THAT as string, { maxRetriesPerRequest: null });
      q = new Queue(TEN_HANG_DOI, { connection: conn });
    });

    afterAll(async () => {
      // Xoá đúng job mình xếp, không obliterate: lỡ TEST_REDIS_URL trỏ nhầm
      // vào Redis có hàng đợi thật thì obliterate là xoá job đang chờ.
      for (const id of daXep) {
        const job = await q.getJob(id);
        await job?.remove();
      }
      await q.close();
      conn.disconnect();
      process.env.QUEUE_REDIS_URL = cu.q;
      process.env.REDIS_URL = cu.r;
      if (cu.q === undefined) delete process.env.QUEUE_REDIS_URL;
      if (cu.r === undefined) delete process.env.REDIS_URL;
    });

    const xep = async (): Promise<{ ok: boolean; id: string }> => {
      const id = `spec-hang-doi-${Date.now()}-${daXep.length}`;
      daXep.push(id);
      const hd = new HangDoiViecNen();
      try {
        const ok = await hd.them(
          JOB_BAO_HANG_MOI,
          {
            seller_id: 1,
            seller_name: 'x',
            product_id: 1,
            product_name: 'x',
            price: 1,
          },
          id,
        );
        return { ok, id };
      } finally {
        await hd.onApplicationShutdown();
      }
    };

    it('có QUEUE_REDIS_URL thì đi vào đó, KHÔNG vào REDIS_URL (cache)', async () => {
      process.env.QUEUE_REDIS_URL = REDIS_THAT;
      // Cổng 1 không ai nghe: nếu mã còn đọc REDIS_URL thì xếp hỏng ngay.
      process.env.REDIS_URL = 'redis://127.0.0.1:1';
      const { ok, id } = await xep();
      expect(ok).toBe(true);
      expect(await q.getJob(id)).toBeDefined();
    });

    it('chưa đặt QUEUE_REDIS_URL thì vẫn chạy như cũ qua REDIS_URL', async () => {
      delete process.env.QUEUE_REDIS_URL;
      process.env.REDIS_URL = REDIS_THAT;
      const { ok, id } = await xep();
      expect(ok).toBe(true);
      expect(await q.getJob(id)).toBeDefined();
    });
  },
);
