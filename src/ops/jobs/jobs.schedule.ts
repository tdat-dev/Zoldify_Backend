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
      { name: l.ten },
    );
  }
}

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
