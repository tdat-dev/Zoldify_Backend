import type { Cache } from '@nestjs/cache-manager';

/**
 * Nhớ ngắn hạn một kết quả đắt (số đếm, thống kê) qua cache dùng chung.
 *
 * Cùng hai nguyên tắc với cache của `ProductsService`:
 *  · SINGLE-FLIGHT: `wrap` gộp mọi request cùng trượt một khoá thành MỘT lần
 *    chạy `loader` (đo ở products: 1.000 lời gọi đồng thời → 1 truy vấn). Một
 *    câu đếm cả triệu dòng mà để 50 request cùng chạy lúc cache vừa hết hạn
 *    thì chính nó chiếm hết pool kết nối.
 *  · FAIL-OPEN: cache lỗi (Redis rớt) hay không có cache (spec dựng service
 *    bằng tay) thì chạy thẳng `loader`. Cache là để nhanh, không được làm hỏng
 *    request.
 */
export async function nhoNgan<T>(
  cache: Cache | undefined,
  khoa: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  if (!cache) return loader();
  try {
    return await cache.wrap(khoa, loader, ttlMs);
  } catch {
    return loader();
  }
}

/** Đọc một khoá, lỗi thì coi như trượt. */
export async function docNho<T>(
  cache: Cache | undefined,
  khoa: string,
): Promise<T | undefined> {
  if (!cache) return undefined;
  try {
    return (await cache.get<T>(khoa)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Ghi một khoá, lỗi thì bỏ qua. */
export async function ghiNho(
  cache: Cache | undefined,
  khoa: string,
  giaTri: unknown,
  ttlMs: number,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.set(khoa, giaTri, ttlMs);
  } catch {
    /* fail-open */
  }
}
