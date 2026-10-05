import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface TaiKhoanTaiLieu {
  user: string;
  pass: string;
}

export type QuyetDinh = 'cho' | 'doi-dang-nhap' | 'giau';

/**
 * Mật khẩu ngắn hơn mức này coi như KHÔNG đặt.
 *
 * Đặt `SWAGGER_PASSWORD=1` rồi tưởng mình đã khoá cửa còn tệ hơn không khoá: nó
 * tạo cảm giác an toàn sai, và không ai đi kiểm lại thứ mình tin là đã xong.
 */
const DAI_TOI_THIEU = 8;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/** So chuỗi bí mật không rò rỉ thông tin qua thời gian so sánh. */
function bangNhau(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  // `timingSafeEqual` ném khi hai bên khác độ dài, nên phải chặn trước — và
  // chính việc đó đã để lộ độ dài. Chấp nhận: độ dài mật khẩu không phải bí mật
  // đáng giá, còn nội dung thì có.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Ai được xem `/api/docs`.
 *
 * TÌNH TRẠNG TRƯỚC KHI CÓ HÀM NÀY, đo bằng curl:
 *
 *   https://api-staging.zoldify.com/api/docs   200
 *   https://api.zoldify.com/api/docs           200
 *
 * Toàn bộ 98 route và 62 schema — gồm cả đường quản trị và đường tiền — mở cho
 * bất kỳ ai. Bản thân nó không phải lỗ hổng, nhưng nó là **tấm bản đồ** cho
 * người đi tìm lỗ hổng: khỏi phải dò, cứ đọc.
 *
 * VÌ SAO KHÔNG DÙNG `NODE_ENV === 'production'` LÀM ĐIỀU KIỆN.
 *
 * Vì như thế là treo an toàn vào một biến môi trường đặt đúng. Đặt sót một chỗ
 * — một container mới, một lần chạy tay, một script quên `-e` — là hở mà không
 * ai biết, và không có gì báo. Quy tắc dưới đây **hỏng về phía đóng**: mặc định
 * là từ chối, mở ra phải có lý do cụ thể.
 *
 * TRẢ 404 CHỨ KHÔNG 401 khi không có tài khoản. 401 là xác nhận "có tài liệu ở
 * đây, mời thử mật khẩu" — vẫn cho người dò biết chỗ mà nhắm.
 */
export function choPhepXemTaiLieu(
  tk: TaiKhoanTaiLieu,
  header: string | undefined,
  ip: string,
): QuyetDinh {
  const coTaiKhoan = tk.user.length > 0 && tk.pass.length >= DAI_TOI_THIEU;

  if (!coTaiKhoan) {
    // Không đặt tài khoản: chỉ máy đang chạy mới xem được. Người ngoài không
    // giả được địa chỉ loopback, nên đây là cửa an toàn cho máy cá nhân mà
    // không bắt ai phải cấu hình gì.
    return LOOPBACK.has(ip) ? 'cho' : 'giau';
  }

  // Đã đặt tài khoản thì áp cho TẤT CẢ, kể cả loopback: chừa cửa cho loopback
  // là mở đường cho bất kỳ tiến trình nào chạy chung máy chủ.
  if (!header || !header.startsWith('Basic ')) return 'doi-dang-nhap';

  let giaiMa = '';
  try {
    giaiMa = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return 'doi-dang-nhap';
  }
  const cat = giaiMa.indexOf(':');
  if (cat < 0) return 'doi-dang-nhap';

  const u = giaiMa.slice(0, cat);
  const p = giaiMa.slice(cat + 1);
  return bangNhau(u, tk.user) && bangNhau(p, tk.pass) ? 'cho' : 'doi-dang-nhap';
}

/** Middleware gắn vào `/api/docs` và `/api/docs-json` trong `main.ts`. */
export function chanTaiLieu(tk: TaiKhoanTaiLieu) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // `req.ip` chứ không header `Host`: `trust proxy` đã bật trong main.ts nên
    // Express lấy IP thật từ `X-Forwarded-For` do Caddy/nginx đặt.
    const quyet = choPhepXemTaiLieu(
      tk,
      req.header('authorization'),
      req.ip ?? '',
    );
    if (quyet === 'cho') return next();
    if (quyet === 'doi-dang-nhap') {
      res.setHeader('WWW-Authenticate', 'Basic realm="Zoldify API docs"');
      res.status(401).send('Cần đăng nhập');
      return;
    }
    res.status(404).send('Not Found');
  };
}

/** Đọc tài khoản từ biến môi trường. */
export function taiKhoanTuMoiTruong(): TaiKhoanTaiLieu {
  return {
    user: process.env.SWAGGER_USER ?? '',
    pass: process.env.SWAGGER_PASSWORD ?? '',
  };
}
