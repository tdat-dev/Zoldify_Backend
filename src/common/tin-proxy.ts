import type { Express } from 'express';

/**
 * Express tin những chặng proxy nào khi đọc `req.ip`.
 *
 * `req.ip` là khoá của ThrottlerGuard (`getTracker` mặc định của
 * @nestjs/throttler 6 trả đúng `req.ip`), của nhật ký thao tác quản trị và của
 * cửa `/api/docs`. Đặt sai giá trị này thì cả ba cùng sai một lúc.
 *
 * VÌ SAO KHÔNG CÒN `1`.
 *
 * Đường đi thật trên VPS: khách -> Cloudflare -> nginx máy chủ -> Caddy
 * (container) -> api. `1` nghĩa là "tin đúng một chặng", tức lấy phần tử cuối
 * của X-Forwarded-For. Phần tử cuối đó là IP mà Caddy ghi cho chặng trước nó:
 * cổng docker 172.18.0.1, giống nhau cho MỌI người. Đo ngày 02/11: cả trang
 * dùng chung một xô 10 req/s, một máy gửi 4 req/s nhận 429 cho cả 12 request.
 * Đổi thành `2` cũng không bền: thêm hay bớt một chặng (bỏ nginx, gọi thẳng
 * Caddy) là lệch lại, và lệch về phía cho khách tự viết IP của mình.
 *
 * VÌ SAO TIN THEO DẢI ĐỊA CHỈ RIÊNG.
 *
 * Mọi proxy của ta (nginx trên máy chủ, Caddy, mạng docker) đều nói chuyện
 * bằng địa chỉ loopback / private. Tin đúng những dải đó thì `req.ip` là địa
 * chỉ CÔNG KHAI ngoài cùng bên phải trong XFF, bất kể có mấy chặng:
 *
 *   socket 172.18.0.5, XFF "1.2.3.4, 203.0.113.7, 172.18.0.1"  ->  203.0.113.7
 *
 * Khách tự gửi XFF thì phần giả nằm BÊN TRÁI địa chỉ thật mà proxy ghi, nên
 * không được dùng. Khách nối thẳng từ Internet (socket công khai) thì XFF bị
 * bỏ qua hoàn toàn. Caddy cũng chỉ tin XFF từ peer private (`trusted_proxies
 * static private_ranges` trong Caddyfile), nên hai lớp cùng một quy tắc.
 *
 * Giới hạn đã biết: nếu nginx KHÔNG đổi $remote_addr sang IP thật (thiếu
 * `real_ip_header CF-Connecting-IP`) thì địa chỉ công khai ngoài cùng là IP
 * máy Cloudflare, vẫn sai nhưng chia theo vài trăm máy biên chứ không còn một
 * xô. Cấu hình nginx nằm ở docs/bao-cao/ip-that-gioi-han.md.
 */
export const TIN_PROXY = 'loopback, linklocal, uniquelocal';

/** Gắn quy tắc tin proxy vào app Express bên dưới Nest. */
export function ganTinProxy(app: Express): void {
  app.set('trust proxy', TIN_PROXY);
}
