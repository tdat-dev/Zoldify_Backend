import type { Express } from 'express';

/**
 * Express tin bao nhiêu chặng proxy khi đọc `req.ip`.
 *
 * `req.ip` là khoá của ThrottlerGuard (`getTracker` mặc định của
 * @nestjs/throttler 6 trả đúng `req.ip`), của nhật ký thao tác quản trị và của
 * cửa `/api/docs`. Đặt sai giá trị này thì cả ba cùng sai một lúc.
 */
export const TIN_PROXY: boolean | number | string = 1;

/** Gắn quy tắc tin proxy vào app Express bên dưới Nest. */
export function ganTinProxy(app: Express): void {
  app.set('trust proxy', TIN_PROXY);
}
