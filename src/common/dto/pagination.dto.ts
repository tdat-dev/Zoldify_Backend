import { BadRequestException } from '@nestjs/common';

/**
 * Khuôn phân trang dùng chung.
 *
 * Mọi service trả danh sách trong dự án đều dùng đúng hình dạng này:
 *   { meta: { current, pageSize, pages, total }, result: [...] }
 *
 * Khai báo ở một chỗ để web và app sinh ra cùng một kiểu, thay vì mỗi
 * endpoint tự mô tả lại rồi lệch nhau.
 */
export class PaginationMetaDto {
  /** Trang hiện tại, bắt đầu từ 1 */
  current: number;

  /** Số bản ghi mỗi trang */
  pageSize: number;

  /** Tổng số trang */
  pages: number;

  /**
   * Tổng số bản ghi khớp điều kiện lọc. Danh sách công khai chỉ đếm tới trần
   * độ sâu (`MAX_PAGINATION_DEPTH`); vượt trần thì `total` = trần và có thêm
   * `total_capped`.
   */
  total: number;

  /**
   * Chỉ có mặt (và luôn là `true`) khi `total` bị chặn ở trần: số thật lớn
   * hơn. Client nên hiện "10.000+" thay vì "10.000".
   */
  total_capped?: boolean;
}

/** Số bản ghi mỗi trang mặc định khi client không gửi `limit`. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Trần cứng cho số bản ghi mỗi trang. Đây là CHỐT AN TOÀN: nếu không chặn,
 * `?limit=1000000` sẽ bắt service nạp cả triệu dòng vào RAM (đúng kiểu lỗi từng
 * làm treo `/orders`). UI thực tế chỉ dùng ~20/trang; ai cần nhiều hơn 100 thì
 * phân trang tiếp, không kéo một phát.
 */
export const MAX_PAGE_SIZE = 100;

export interface NormalizedPagination {
  /** Trang đã ép về ≥ 1 */
  page: number;
  /** Số bản ghi/trang đã ép về khoảng [1, MAX_PAGE_SIZE] */
  size: number;
  /** Vị trí bắt đầu (>= 0), dùng cho LIMIT/OFFSET hoặc skip/take */
  offset: number;
}

/**
 * Chuẩn hoá tham số phân trang từ query string về số AN TOÀN, dùng CHUNG cho mọi
 * endpoint trả danh sách.
 *
 * Chặn ba lỗi ẩn hay gặp khi lấy thẳng `parseInt` từ query:
 *  - `limit` khổng lồ (`1000000`) → nạp cả bảng vào RAM. Ép ≤ MAX_PAGE_SIZE.
 *  - `NaN` (`?limit=abc`) hoặc số ≤ 0 (`?limit=0`, `?currentPage=-1`) → OFFSET
 *    âm/NaN gây lỗi SQL, hoặc `pages = Infinity`. Ép về mặc định / cận dưới.
 *  - Số thập phân/rác → làm tròn xuống.
 */
export function normalizePagination(
  currentPage?: string | number | null,
  limit?: string | number | null,
  // Kích thước trang mặc định khi client KHÔNG gửi `limit`. Đa số endpoint dùng
  // 10; vài chỗ (vd chat) mặc định 20 — truyền vào đây để giữ nguyên hành vi cũ.
  defaultSize: number = DEFAULT_PAGE_SIZE,
): NormalizedPagination {
  const rawPage = Math.floor(Number(currentPage));
  const rawSize = Math.floor(Number(limit));

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  let size = Number.isFinite(rawSize) && rawSize >= 1 ? rawSize : defaultSize;
  if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;

  return { page, size, offset: (page - 1) * size };
}

/**
 * Trần ĐỘ SÂU của danh sách công khai phân trang bằng OFFSET: chỉ với tới
 * 10.000 dòng đầu (trang × cỡ trang ≤ 10.000).
 *
 * `normalizePagination` chặn CỠ trang nhưng không chặn SỐ trang:
 * `?current=9000&pageSize=100` thành `LIMIT 100 OFFSET 899900`. OFFSET không
 * nhảy cóc được: MySQL vẫn đọc 899.900 dòng rồi vứt đi mới trả 100 dòng, đo ở
 * bảng đơn ~2,8 giây (xem `encodeCursor`). Route công khai nên ai gõ URL cũng
 * gọi được, vài chục request như thế đủ chiếm hết pool kết nối.
 *
 * Vì sao 10.000: Elasticsearch chọn đúng số này cho `max_result_window`, và
 * không người thật nào bấm "trang sau" tới trang 500 (cỡ 20). Ai cần đi hết
 * dữ liệu thì dùng bộ lọc, hoặc đường keyset như `/orders`.
 */
export const MAX_PAGINATION_DEPTH = 10_000;

export interface CatDoSau {
  /** Trang nằm trọn ngoài trần: KHÔNG được truy vấn dòng nào. */
  ngoaiTran: boolean;
  /** Số dòng được lấy ở trang này (trang cuối trong trần có thể bị cắt bớt). */
  take: number;
}

/**
 * Áp trần độ sâu cho một trang đã chuẩn hoá.
 *
 * Trang ngoài trần trả DANH SÁCH RỖNG kèm meta bình thường, không trả 400.
 * Lý do: app di động cuộn vô hạn cứ gọi "trang sau" tới khi nhận mảng rỗng.
 * Mảng rỗng là tín hiệu "hết danh sách" mà mọi client đã hiểu sẵn; 400 thì
 * client cũ hiện màn lỗi giữa chừng. Và `meta.total` của các danh sách này
 * cũng chỉ đếm tới trần (`demCoTran`), nên `meta.pages` không bao giờ chỉ tới
 * một trang ngoài trần: chỉ ai tự gõ URL mới gặp mảng rỗng.
 *
 * Trang cuối vắt qua trần (cỡ 30, trang 334: dòng 9.991 tới 10.020) bị cắt
 * còn 10 dòng, để tổng số dòng đọc được khớp đúng `total` đã báo.
 */
export function catDoSau(
  p: Pick<NormalizedPagination, 'offset' | 'size'>,
  tran: number = MAX_PAGINATION_DEPTH,
): CatDoSau {
  if (p.offset >= tran) return { ngoaiTran: true, take: 0 };
  return { ngoaiTran: false, take: Math.min(p.size, tran - p.offset) };
}

// ───────────────────────── Con trỏ keyset (phân trang trang sâu) ─────────────────────────

/** Vị trí keyset: (created_at, id) của bản ghi CUỐI trang trước. */
export interface KeysetCursor {
  /**
   * Mốc thời gian dạng CHUỖI 'YYYY-MM-DD HH:MM:SS.ffffff' — GIỮ NGUYÊN micro-giây.
   *
   * KHÔNG dùng JS `Date`/`getTime()`: cột `created_at` là `timestamp(6)` (µs) còn
   * `Date` chỉ có mili-giây → cắt mất 3 chữ số cuối. Đơn tạo qua app lấy default
   * `CURRENT_TIMESTAMP(6)` nên CÓ µs thật; nếu con trỏ mất µs thì điều kiện
   * `created_at < con_trỏ` sẽ BỎ SÓT các đơn nằm trong khe µs bị cắt. Truyền
   * nguyên chuỗi µs (lấy từ DATE_FORMAT '%f') để so sánh đúng tuyệt đối.
   */
  createdAt: string;
  id: number;
}

/** Định dạng hợp lệ: 'YYYY-MM-DD HH:MM:SS' kèm phần lẻ tuỳ chọn tới µs. */
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

/**
 * Mã hoá con trỏ thành chuỗi mờ (opaque) để client truyền lại nguyên văn.
 *
 * Vì sao dùng keyset thay vì OFFSET ở trang sâu: `LIMIT 20 OFFSET 500000` bắt DB
 * quét bỏ 500k dòng mới lấy được 20 dòng (đo được ~2.8s). Keyset thêm điều kiện
 * `(created_at, id) < con_trỏ` nên đi thẳng vào index. `createdAt` phải là chuỗi
 * µs đầy đủ để không sót/không lặp ở ranh giới.
 */
export function encodeCursor(createdAt: string, id: number): string {
  // Ngăn cách bằng '|' (chuỗi datetime không chứa ký tự này).
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

/** Giải mã con trỏ; sai định dạng → 400 (không nuốt lỗi âm thầm). */
export function decodeCursor(cursor: string): KeysetCursor {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Con trỏ phân trang (cursor) không hợp lệ');
  }
  const bar = raw.lastIndexOf('|');
  const createdAt = bar >= 0 ? raw.slice(0, bar) : '';
  const id = Number(raw.slice(bar + 1));
  if (
    bar < 0 ||
    !CURSOR_TS_RE.test(createdAt) ||
    !Number.isInteger(id) ||
    id < 0
  ) {
    throw new BadRequestException('Con trỏ phân trang (cursor) không hợp lệ');
  }
  return { createdAt, id };
}
