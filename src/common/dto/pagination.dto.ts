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

  /** Tổng số bản ghi khớp điều kiện lọc */
  total: number;
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
): NormalizedPagination {
  const rawPage = Math.floor(Number(currentPage));
  const rawSize = Math.floor(Number(limit));

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  let size =
    Number.isFinite(rawSize) && rawSize >= 1 ? rawSize : DEFAULT_PAGE_SIZE;
  if (size > MAX_PAGE_SIZE) size = MAX_PAGE_SIZE;

  return { page, size, offset: (page - 1) * size };
}

// ───────────────────────── Con trỏ keyset (phân trang trang sâu) ─────────────────────────

/** Vị trí keyset: cặp (created_at, id) của bản ghi CUỐI trang trước. */
export interface KeysetCursor {
  createdAt: Date;
  id: number;
}

/**
 * Mã hoá con trỏ thành chuỗi mờ (opaque) để client truyền lại nguyên văn.
 *
 * Vì sao dùng keyset thay vì OFFSET ở trang sâu: `LIMIT 20 OFFSET 500000` bắt DB
 * quét bỏ 500k dòng mới lấy được 20 dòng (đo được ~2.8s). Keyset thêm điều kiện
 * `(created_at, id) < con_trỏ` nên đi thẳng vào index, không quét thừa — nhanh
 * như trang đầu ở mọi độ sâu. Cặp `(created_at, id)` phải khớp ĐÚNG khoá sắp xếp
 * `ORDER BY created_at DESC, id DESC` để không sót/không lặp.
 */
export function encodeCursor(createdAt: Date, id: number): string {
  return Buffer.from(`${createdAt.getTime()}.${id}`, 'utf8').toString(
    'base64url',
  );
}

/** Giải mã con trỏ; sai định dạng → 400 (không nuốt lỗi âm thầm). */
export function decodeCursor(cursor: string): KeysetCursor {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Con trỏ phân trang (cursor) không hợp lệ');
  }
  const dot = raw.indexOf('.');
  const ms = Number(raw.slice(0, dot));
  const id = Number(raw.slice(dot + 1));
  if (dot < 0 || !Number.isFinite(ms) || !Number.isInteger(id) || id < 0) {
    throw new BadRequestException('Con trỏ phân trang (cursor) không hợp lệ');
  }
  return { createdAt: new Date(ms), id };
}
