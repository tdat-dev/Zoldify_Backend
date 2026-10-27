import type { Queue } from 'bullmq';
import { LICH_LAP, type LichLap } from './jobs.constants';

/**
 * Ghi lịch lặp vào Redis.
 *
 * Hàm THUẦN, nhận `Queue` từ ngoài thay vì tự dựng lấy. Nhờ vậy
 * scripts/selfcheck-worker.ts gọi được nó trên một hàng đợi test riêng mà
 * không phải dựng cả Nest lên.
 *
 * VÌ SAO `upsertJobScheduler` CHỨ KHÔNG PHẢI `queue.add(..., { repeat })`.
 *
 * Cách cũ (`repeat`) khoá bản ghi lặp bằng một khoá băm từ NỘI DUNG lịch —
 * tên job + biểu thức cron + tz. Nên hôm nào đổi '0 * * * *' thành '7 * * * *'
 * thì BullMQ không thấy đó là "cùng một lịch, sửa giờ", nó thấy một lịch chưa
 * từng có: ghi thêm bản mới, giữ nguyên bản cũ. Từ đó hai bản ghi cùng đẻ job.
 *
 * Kết quả đúng bằng con bệnh mà task #14 đi chữa — job tiền chạy hai lần —
 * chỉ khác là lần này nó lẻn vào qua một lần sửa lịch tưởng là vô hại. Ai sửa
 * cũng không nghi ngờ gì, vì mã trông vẫn "một job một lịch".
 *
 * `upsertJobScheduler` khoá theo ID mình tự đặt, nên đổi pattern là thay tại
 * chỗ. selfcheck-worker.ts kiểm đúng điều này bằng cách gọi hai lần với hai
 * pattern khác nhau rồi đếm số bản ghi.
 */
export async function dangKyLichLap(
  queue: Queue,
  lich: readonly LichLap[] = LICH_LAP,
): Promise<void> {
  for (const l of lich) {
    await queue.upsertJobScheduler(
      l.id,
      { pattern: l.pattern, tz: 'Asia/Ho_Chi_Minh' },
      { name: l.ten, opts: GIU_JOB_LICH_LAP },
    );
  }
}

/**
 * Giữ bao nhiêu job lịch lặp đã xong / đã hỏng trong Redis.
 *
 * BullMQ mặc định giữ TẤT CẢ. Ba lịch đẻ 24 + 24 + 288 = 336 job mỗi ngày,
 * hơn 120 nghìn bản ghi một năm không ai đọc, trong khi Redis còn gánh
 * throttler và cache: đầy bộ nhớ là ba thứ chết cùng lúc. Đo bằng
 * `jobs.schedule.spec.ts`.
 *
 * Giữ đủ để điều tra: job xong 7 ngày (tối đa 500, tức gần hai ngày của job
 * 5 phút một lần), job hỏng 30 ngày (tối đa 2000) vì hỏng mới là thứ cần đọc
 * lại. `age` tính bằng GIÂY, không phải mili giây.
 *
 * Đổi `opts` ở đây là thay tại chỗ (upsert theo id), không đẻ lịch thứ hai.
 */
export const GIU_JOB_LICH_LAP = {
  removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
  removeOnFail: { age: 30 * 24 * 3600, count: 2000 },
} as const;

/**
 * Xoá những lịch KHÔNG còn trong danh sách.
 *
 * Bỏ một job khỏi LICH_LAP mà không xoá bản ghi trong Redis thì nó vẫn đẻ job
 * đều đặn, và bộ xử lý không còn nhánh nào nhận tên đó — job vào hàng rồi
 * failed mỗi giờ một lần, mãi mãi. Redis nhớ dai hơn mã nguồn.
 */
export async function donLichThua(
  queue: Queue,
  lich: readonly LichLap[] = LICH_LAP,
): Promise<string[]> {
  const giu = new Set(lich.map((l) => l.id));
  const daXoa: string[] = [];
  for (const s of await queue.getJobSchedulers()) {
    const key = String(s.key ?? s.id ?? '');
    if (key && !giu.has(key)) {
      await queue.removeJobScheduler(key);
      daXoa.push(key);
    }
  }
  return daXoa;
}
