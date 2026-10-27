import type { Queue } from 'bullmq';
import { dangKyLichLap } from './jobs.schedule';
import { LICH_LAP } from './jobs.constants';

/**
 * Job sinh từ lịch lặp phải tự dọn khỏi Redis.
 *
 * BullMQ mặc định GIỮ MỌI job đã xong và đã hỏng. Ba lịch hiện có đẻ
 * 24 + 24 + 288 = 336 job mỗi ngày, tức hơn 120 nghìn bản ghi một năm nằm
 * trong Redis không ai đọc (mỗi bản kèm dữ liệu, kết quả, stacktrace nếu
 * hỏng). Redis là bộ nhớ, không phải ổ đĩa: tới lúc đầy thì throttler, cache
 * và hàng đợi chết cùng lúc. Job "báo hàng mới" xếp từ api đã có giới hạn
 * (`@common/hang-doi`), chỉ lịch lặp là chưa.
 */
describe('Lịch lặp tự dọn job cũ', () => {
  it('mọi lịch đặt removeOnComplete và removeOnFail có giới hạn', async () => {
    const goi: Array<{ id: string; mau: { opts?: Record<string, unknown> } }> =
      [];
    const queue = {
      upsertJobScheduler: (
        id: string,
        _lap: unknown,
        mau: { opts?: Record<string, unknown> },
      ) => {
        goi.push({ id, mau });
        return Promise.resolve();
      },
    } as unknown as Queue;

    await dangKyLichLap(queue);

    expect(goi).toHaveLength(LICH_LAP.length);
    for (const g of goi) {
      const opts = g.mau.opts ?? {};
      // Số (giữ N job gần nhất) hoặc { count } / { age }: cả hai đều là có
      // giới hạn. `true` (xoá ngay) cũng chấp nhận được, chỉ `undefined` thì không.
      expect(opts.removeOnComplete).toBeDefined();
      expect(opts.removeOnFail).toBeDefined();
      expect(opts.removeOnComplete).not.toBe(false);
      expect(opts.removeOnFail).not.toBe(false);
    }
  });
});
