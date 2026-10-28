import type { Queue } from 'bullmq';
import { dangKyLichLap, GIU_JOB_LICH_LAP } from './jobs.schedule';
import {
  JOB_DON_THONG_BAO_CU,
  LICH_LAP,
  TEN_HANG_DOI,
  lichCuaHangDoi,
} from './jobs.constants';

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

/**
 * Dọn thông báo cũ phải có lịch thật (rà soát "1 triệu dòng" 28/10, mục 7).
 *
 * Nhánh perf/1m-truy-van viết xong `donThongBaoCu` nhưng để TODO đăng ký job:
 * chỉ chạy tay thì bảng notifications vẫn phình mãi (mỗi lần người bán đăng
 * hàng là một dòng cho TỪNG người theo dõi). Bài này gác ba điều: lịch có
 * trong LICH_LAP, nằm trên hàng đợi CHÍNH (không chen vào hàng đợi vận đơn
 * vốn chạy tới 20 phút), và chạy MỖI NGÀY MỘT LẦN chứ không phải mỗi giờ.
 */
describe('Lịch dọn thông báo cũ', () => {
  const lich = LICH_LAP.find((l) => l.ten === JOB_DON_THONG_BAO_CU);

  it('có trong LICH_LAP, trên hàng đợi chính', () => {
    expect(lich).toBeDefined();
    expect(lich?.hangDoi).toBe(TEN_HANG_DOI);
    expect(lichCuaHangDoi(TEN_HANG_DOI)).toContain(lich);
  });

  it('chạy một lần mỗi đêm, không rơi vào phút 0 của bản dump 3 giờ', () => {
    const [phut, gio, ngay, thang, thu] = (lich?.pattern ?? '').split(' ');
    expect(Number(gio)).toBeGreaterThanOrEqual(1);
    expect(Number(gio)).toBeLessThanOrEqual(5);
    expect(Number(phut)).not.toBe(0);
    expect([ngay, thang, thu]).toEqual(['*', '*', '*']);
  });

  it('đăng ký vào hàng đợi chính với cùng giới hạn giữ job', async () => {
    const goi: Array<{ id: string; lap: { pattern?: string }; mau: unknown }> =
      [];
    const queue = {
      upsertJobScheduler: (
        id: string,
        lap: { pattern?: string },
        mau: unknown,
      ) => {
        goi.push({ id, lap, mau });
        return Promise.resolve();
      },
    } as unknown as Queue;

    await dangKyLichLap(queue, lichCuaHangDoi(TEN_HANG_DOI));

    const dk = goi.find((g) => g.id === JOB_DON_THONG_BAO_CU);
    expect(dk?.lap.pattern).toBe(lich?.pattern);
    expect(dk?.mau).toEqual({
      name: JOB_DON_THONG_BAO_CU,
      opts: GIU_JOB_LICH_LAP,
    });
  });
});
