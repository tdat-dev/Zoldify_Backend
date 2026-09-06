import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

/**
 * Bọc một ThrottlerStorage để Redis chết KHÔNG kéo sập API.
 *
 * VÌ SAO CẦN.
 *
 * Cache đã fail-open từ Epic 4: Redis chết thì đọc lại từ MySQL, người dùng
 * chỉ thấy chậm hơn. Nhưng throttler khác ở một điểm quyết định — `ThrottlerGuard`
 * gọi `storage.increment()` ở **mọi request**, kể cả request không liên quan gì
 * tới cache. Nếu lệnh đó ném lỗi thì guard ném lỗi, và mọi request trả 500.
 *
 * Nghĩa là: cắm Redis vào throttler mà không có lớp này thì Redis biến từ một
 * thứ phụ trợ thành một điểm hỏng đơn (single point of failure) của cả sàn.
 * Trước khi làm task #5, Redis chết không ảnh hưởng gì tới rate limit vì rate
 * limit nằm trong RAM. Làm xong mà thiếu lớp này thì tình hình TỆ ĐI, không
 * phải tốt lên — đó là kiểu "cải tiến" đáng sợ nhất.
 *
 * Chọn cho request ĐI QUA khi Redis hỏng, chứ không chặn. Lý do: rate limit là
 * hàng rào chống lạm dụng, không phải hàng rào an toàn. Redis chết mà chặn hết
 * thì một sự cố hạ tầng thành một sự cố ngừng dịch vụ toàn phần. Rủi ro đổi lại
 * là trong lúc Redis chết thì không có giới hạn — chấp nhận được, và có ghi log.
 *
 * `totalHits: 0` là cách nói "chưa ai gọi lần nào" với guard, nên nó cho qua.
 */
export class ThrottlerStorageFailOpen implements ThrottlerStorage {
  /**
   * Chống ngập log. Redis chết thì lỗi xảy ra ở MỌI request — với 700 req/s
   * (số đo được ở Epic 4) là 700 dòng log mỗi giây, đủ để lấp mất chính dòng
   * log nói tại sao mọi thứ hỏng.
   */
  private lanCanhBaoCuoi = 0;
  private static readonly KHOANG_CANH_BAO_MS = 30_000;

  constructor(private readonly benTrong: ThrottlerStorage) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.benTrong.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch (e) {
      const gio = Date.now();
      if (gio - this.lanCanhBaoCuoi > ThrottlerStorageFailOpen.KHOANG_CANH_BAO_MS) {
        this.lanCanhBaoCuoi = gio;
        console.warn(
          `[throttler] Redis không dùng được (${(e as Error).message}) — CHO REQUEST ĐI QUA, ` +
            `rate limit tạm ngưng cho tới khi Redis trở lại.`,
        );
      }
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
