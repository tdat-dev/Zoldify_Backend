/**
 * Tên hàng đợi, tên job và lịch chạy — MỘT chỗ duy nhất.
 *
 * Bên đăng ký lịch (worker lúc khởi động) và bên xử lý job (worker lúc chạy)
 * phải gọi cùng một chuỗi tên. Để hai nơi tự gõ lấy thì gõ lệch một ký tự là
 * job vào hàng đợi rồi nằm đó không ai nhận — không lỗi, không log, chỉ là
 * việc không được làm. Đặt chung ở đây để trình biên dịch bắt thay mình.
 */

/** Một hàng đợi cho mọi job nền. Chưa đủ nhiều việc để phải chia. */
export const TEN_HANG_DOI = 'zoldify-jobs';

export const JOB_HUY_DON_QUA_HAN = 'huy-don-qua-han';
export const JOB_CHOT_VAN_DON = 'chot-van-don';

export interface LichLap {
  /** Khoá của bản ghi lịch trong Redis. ĐỔI id = tạo lịch mới, không phải sửa. */
  id: string;
  /** Tên job sinh ra mỗi lần tới giờ — phải khớp nhánh trong jobs.processor.ts. */
  ten: string;
  /** Biểu thức cron 5 trường. */
  pattern: string;
}

/**
 * Hai job tiền, mỗi giờ một lần — giữ đúng nhịp `@Cron(EVERY_HOUR)` cũ.
 *
 * Nhưng KHÔNG chạy đúng phút 0 nữa. Phút 0 là lúc đông nhất trên máy chủ: cron
 * backup mysqldump (scripts/backup-mysql.sh), log rotate, và mọi thứ khác mà
 * người ta hẹn giờ đều mặc định rơi vào đó. Trước đây hai job này cũng cùng nổ
 * ở phút 0, tức là đọc GHN và quét bảng orders chen nhau trong cùng một giây.
 *
 * Tách ra phút 7 và phút 23: vẫn mỗi giờ một lần, nhưng không job nào phải
 * tranh kết nối database với job kia hay với bản dump.
 */
export const LICH_LAP: readonly LichLap[] = [
  {
    id: JOB_HUY_DON_QUA_HAN,
    ten: JOB_HUY_DON_QUA_HAN,
    pattern: '7 * * * *',
  },
  {
    id: JOB_CHOT_VAN_DON,
    ten: JOB_CHOT_VAN_DON,
    pattern: '23 * * * *',
  },
];
