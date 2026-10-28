/**
 * Tên hàng đợi, tên job và lịch chạy — MỘT chỗ duy nhất.
 *
 * Bên đăng ký lịch (worker lúc khởi động) và bên xử lý job (worker lúc chạy)
 * phải gọi cùng một chuỗi tên. Để hai nơi tự gõ lấy thì gõ lệch một ký tự là
 * job vào hàng đợi rồi nằm đó không ai nhận — không lỗi, không log, chỉ là
 * việc không được làm. Đặt chung ở đây để trình biên dịch bắt thay mình.
 */

/**
 * Hàng đợi chính: huỷ đơn quá hạn, đổ view count, báo hàng mới (api xếp).
 *
 * Tên hàng đợi và job "báo hàng mới" khai ở `@common/hang-doi` vì bên XẾP job
 * đó nằm ở catalog, tầng không được import `ops`. Xuất lại ở đây để mọi chỗ
 * phía worker vẫn chỉ đọc một file.
 */
export { TEN_HANG_DOI, JOB_BAO_HANG_MOI } from '@common/hang-doi';
import { TEN_HANG_DOI } from '@common/hang-doi';

/**
 * Hàng đợi RIÊNG cho chốt vận đơn (đồng bộ GHN + tự xác nhận nhận hàng).
 *
 * Tách ra vì độ dài: một lượt chốt phụ thuộc GHN, chạy tới 20 phút (hạn trong
 * `GIOI_HAN_DONG_BO`), còn worker xử lý MỘT job một lúc mỗi hàng đợi. Chung
 * hàng đợi thì suốt 20 phút đó job huỷ đơn quá hạn (giữ hàng và tiền ký quỹ
 * của người mua) và job đổ view count 5 phút một lần nằm chờ phía sau. Đo bằng
 * `hang-doi-van-don.spec.ts` (rà soát "1 triệu dòng" 28/10).
 *
 * Mỗi hàng đợi vẫn concurrency 1, nên MỖI LOẠI job tiền vẫn không bao giờ
 * chạy chồng lên chính nó (lý do gốc của concurrency 1, task #14).
 */
export const TEN_HANG_DOI_VAN_DON = 'zoldify-jobs-van-don';

export const JOB_HUY_DON_QUA_HAN = 'huy-don-qua-han';
export const JOB_CHOT_VAN_DON = 'chot-van-don';
export const JOB_FLUSH_VIEW_COUNT = 'flush-view-count';

export interface LichLap {
  /** Khoá của bản ghi lịch trong Redis. ĐỔI id = tạo lịch mới, không phải sửa. */
  id: string;
  /** Tên job sinh ra mỗi lần tới giờ — phải khớp nhánh trong jobs.processor.ts. */
  ten: string;
  /** Biểu thức cron 5 trường. */
  pattern: string;
  /** Hàng đợi mà lịch này đăng ký vào và worker của nó nhận job. */
  hangDoi: string;
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
    hangDoi: TEN_HANG_DOI,
  },
  {
    id: JOB_CHOT_VAN_DON,
    ten: JOB_CHOT_VAN_DON,
    pattern: '23 * * * *',
    hangDoi: TEN_HANG_DOI_VAN_DON,
  },
  {
    id: JOB_FLUSH_VIEW_COUNT,
    ten: JOB_FLUSH_VIEW_COUNT,
    pattern: '*/5 * * * *', // Mỗi 5 phút
    hangDoi: TEN_HANG_DOI,
  },
];

/** Các lịch đăng ký vào một hàng đợi. */
export function lichCuaHangDoi(hangDoi: string): readonly LichLap[] {
  return LICH_LAP.filter((l) => l.hangDoi === hangDoi);
}
