import { Logger } from '@nestjs/common';
import type { EventEmitter } from 'node:events';

/**
 * Bộ bắt lỗi CUỐI CÙNG của tiến trình, cho cả api (`main.ts`) lẫn worker
 * (`worker.ts`).
 *
 * VÌ SAO CẦN. Node 15+ mặc định `--unhandled-rejections=throw`: một lời hứa
 * bị từ chối mà không ai `.catch` là cả tiến trình chết, kéo theo mọi request
 * đang chạy, và dòng log duy nhất là stack mặc định của Node in ra stderr,
 * không qua JsonLogger, không có mã request. Rà soát 26/10 tìm thấy đúng một
 * chỗ như thế (`void this.pushToUser` trong notifications.service.ts): FCM từ
 * chối là đủ để api sập. Chỗ đó đã vá, nhưng chỗ tiếp theo sẽ có người viết.
 *
 * HAI LOẠI, HAI CÁCH XỬ.
 *  · unhandledRejection SAU KHI ĐÃ KHỞI ĐỘNG: GHI LOG, KHÔNG THOÁT. Đây gần
 *    như luôn là một việc phụ chạy nền (đẩy push, phát tồn kho) quên `.catch`;
 *    trạng thái của tiến trình vẫn nguyên vẹn, giết nó vì thế là đổi một dòng
 *    lỗi lấy hàng trăm request đang dở.
 *  · unhandledRejection TRONG LÚC KHỞI ĐỘNG: GHI LOG rồi THOÁT MÃ 1. Bản đầu
 *    (review 26/10) chỉ ghi log ở mọi lúc, nên cổng bị chiếm (EADDRINUSE), DB
 *    không nối được hay cấu hình sai lúc boot để lại một container "Up" không
 *    nghe cổng nào, và `restart: unless-stopped` không bao giờ dựng lại nó.
 *    Người gọi báo "đã khởi động xong" bằng `daKhoiDong()` của giá trị trả về,
 *    NGAY SAU `app.listen` (api) hoặc sau khi dựng xong module (worker).
 *  · uncaughtException: GHI LOG rồi THOÁT MÃ 1. Lỗi đồng bộ đã xé ngang một
 *    ngăn xếp gọi giữa chừng, tài liệu Node nói rõ trạng thái sau đó không còn
 *    tin được. Không có bộ bắt thì Node cũng thoát 1; khác biệt duy nhất là
 *    giờ có một dòng log đọc được trước khi `restart: unless-stopped` dựng
 *    lại container.
 *
 * Tham số thứ hai chỉ để bài kiểm thay `process`, logger và `process.exit`.
 */
export function ganBatLoiTienTrinh(
  ten: string,
  boCuc: {
    tienTrinh?: Pick<EventEmitter, 'on'>;
    logger?: { error: (message: string, stack?: string) => void };
    thoat?: (ma: number) => void;
  } = {},
): { daKhoiDong: () => void } {
  const tienTrinh = boCuc.tienTrinh ?? process;
  const logger = boCuc.logger ?? new Logger(ten);
  const thoat = boCuc.thoat ?? ((ma: number) => process.exit(ma));
  let xong = false;

  tienTrinh.on('unhandledRejection', (lyDo: unknown) => {
    const e = lyDo instanceof Error ? lyDo : undefined;
    const moTa = e ? e.message : String(lyDo);
    if (!xong) {
      logger.error(
        `unhandledRejection lúc khởi động (thoát mã 1): ${moTa}`,
        e?.stack,
      );
      thoat(1);
      return;
    }
    logger.error(`unhandledRejection (tiến trình vẫn chạy): ${moTa}`, e?.stack);
  });

  tienTrinh.on('uncaughtException', (loi: unknown) => {
    const e = loi instanceof Error ? loi : undefined;
    logger.error(
      `uncaughtException (thoát mã 1): ${e ? e.message : String(loi)}`,
      e?.stack,
    );
    thoat(1);
  });

  return {
    daKhoiDong: () => {
      xong = true;
    },
  };
}
