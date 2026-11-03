import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Cache ở BIÊN (Cloudflare) cho route công khai, đọc nhiều, giống nhau với
 * mọi khách vãng lai.
 *
 * VÌ SAO CẦN, KHI REDIS ĐÃ CACHE DANH SÁCH.
 *
 * Redis chỉ bớt câu SQL. Mỗi lượt cuộn trang chủ vẫn đi trọn đường
 * Cloudflare -> nginx -> Caddy -> một trong ba bản api trên MỘT VPS, qua
 * guard, throttler, serialize JSON, gzip. Nghìn người cùng mở trang chủ là
 * nghìn lượt như thế cho cùng một kết quả. Cloudflare giữ bản sao vài chục
 * giây thì mỗi điểm biên hỏi origin khoảng một lần mỗi chu kỳ cho mỗi URL.
 *
 * VÌ SAO CDN-Cache-Control CHỨ KHÔNG PHẢI `s-maxage`.
 *
 * Thiết kế đầu dùng `public, max-age=0, s-maxage=30, stale-while-revalidate`.
 * Tài liệu Cloudflare (Revalidation, 2026) ghi rõ: có `s-maxage` thì
 * Cloudflare coi như `proxy-revalidate` và TẮT cả stale-while-revalidate lẫn
 * stale-if-error. Tức là đúng lúc hết hạn, mọi request dồn về origin chờ bản
 * mới, và VPS sập thì khách nhận lỗi thay vì bản cũ. Nên tách hai lớp:
 *  - `Cache-Control: public, max-age=0`: trình duyệt hỏi lại mỗi lần (rẻ, vì
 *    Cloudflare trả HIT hoặc 304 theo ETag).
 *  - `CDN-Cache-Control: max-age=N, stale-while-revalidate=N,
 *    stale-if-error=300`: Cloudflare đọc header này TRƯỚC Cache-Control.
 *
 * LUẬT, theo thứ tự (luật trên thắng):
 *  1. Không phải GET/HEAD: không đụng. Decorator dán nhầm lên POST cũng vô hại.
 *  2. Có header Authorization (kể cả token hỏng): `private, no-store`.
 *     Cloudflare không tách cache theo token. Rule Cloudflare cũng loại
 *     request có Authorization, đây là lớp thứ hai.
 *  3. Response có Set-Cookie: `private, no-store`.
 *  4. Handler đã tự đặt Cache-Control (ví dụ bản nháp): giữ nguyên.
 *  5. Không phải 2xx: không đụng. Lỗi đi qua exception filter, không qua
 *     `tap` này, nên 404/429/500/503 không bao giờ mang header cache biên.
 *     Rule Cloudflare đặt "bypass nếu không có cache-control", nên lỗi
 *     không được cache.
 *
 * CORS. `main.ts` phản chiếu origin trong danh sách SITE_URL kèm
 * `credentials`. Cloudflare không tách cache theo Origin, nên bản đầu tiên vào
 * cache (từ app di động không gửi Origin, hoặc từ admin) sẽ mang ACAO sai cho
 * mọi trang web khác, và trình duyệt chặn cả danh sách. Với đúng các response
 * được cache biên (công khai, không danh tính, chỉ đọc) đặt ACAO `*` và bỏ
 * credentials: web, admin, app đều không gửi cookie (xác thực bằng Bearer),
 * và dữ liệu này ai gọi thẳng cũng lấy được, nên `*` không mở thêm gì.
 *
 * NỢ: ba client gửi Authorization ở MỌI request khi đã đăng nhập
 * (`Zoldify_Frontend/src/lib/http.ts`), nên người đã đăng nhập vẫn đi thẳng
 * origin. Gỡ: client bỏ token ở các GET công khai này (kết quả không phụ thuộc
 * người xem, xem bài quét trong cache-bien.spec.ts).
 */
export const CACHE_BIEN = 'CACHE_BIEN';

/** Cloudflare được trả bản cũ tối đa ngần này giây khi origin lỗi hoặc sập. */
const CU_KHI_LOI = 300;

export function ganHeaderCacheBien(
  req: Request,
  res: Response,
  giay: number,
): void {
  if (res.headersSent) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  if (req.headers.authorization !== undefined || res.getHeader('Set-Cookie')) {
    res.setHeader('Cache-Control', 'private, no-store');
    return;
  }
  if (res.getHeader('Cache-Control') !== undefined) return;
  if (res.statusCode < 200 || res.statusCode >= 300) return;

  res.setHeader('Cache-Control', 'public, max-age=0');
  res.setHeader(
    'CDN-Cache-Control',
    `max-age=${giay}, stale-while-revalidate=${giay}, stale-if-error=${CU_KHI_LOI}`,
  );
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.removeHeader('Access-Control-Allow-Credentials');
  const vary = String(res.getHeader('Vary') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'origin');
  if (vary.length) res.setHeader('Vary', vary.join(', '));
  else res.removeHeader('Vary');
}

@Injectable()
export class CacheBienInterceptor implements NestInterceptor {
  constructor(private readonly giay: number) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    // Đặt SAU handler (lúc có kết quả) chứ không trước: handler có thể tự đặt
    // Cache-Control hoặc Set-Cookie, và luật 3, 4 phải thấy được chúng.
    return next
      .handle()
      .pipe(tap(() => ganHeaderCacheBien(req, res, this.giay)));
  }
}

/**
 * Cho Cloudflare giữ response của route này `giay` giây với khách vãng lai.
 *
 * Chỉ dán lên GET `@Public()` có kết quả GIỐNG NHAU với mọi người xem. Bài
 * quét trong cache-bien.spec.ts giữ danh sách route được phép; thêm route mới
 * là sửa cả danh sách đó.
 */
export function CacheBien(giay = 30): MethodDecorator {
  return applyDecorators(
    SetMetadata(CACHE_BIEN, giay),
    UseInterceptors(new CacheBienInterceptor(giay)),
  );
}
