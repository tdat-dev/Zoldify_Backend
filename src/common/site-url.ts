/**
 * Địa chỉ CHÍNH của trang, lấy từ `SITE_URL`.
 *
 * VÌ SAO CẦN MỘT HÀM CHO MỘT VIỆC TRÔNG NHƯ CHỈ ĐỌC BIẾN MÔI TRƯỜNG.
 *
 * Vì `SITE_URL` không phải một địa chỉ — nó là một DANH SÁCH. `main.ts` dùng nó
 * làm danh sách origin được phép cho CORS:
 *
 *   const allowedOrigins = (process.env.SITE_URL || 'http://localhost:3001')
 *     .split(',')
 *
 * Và trên staging nó đang là:
 *
 *   SITE_URL=https://staging.zoldify.com,https://admin-staging.zoldify.com
 *
 * Hai chỗ khác lại đọc thẳng biến đó rồi nối đường dẫn vào sau. Kết quả đang
 * chạy thật trên staging, đo bằng curl:
 *
 *   sitemap: <loc>https://staging.zoldify.com,https://admin-staging.zoldify.com/sitemap-static.xml</loc>
 *   PayOS:   returnUrl = https://staging.zoldify.com,https://admin-staging.zoldify.com/payment/return?orderId=123
 *
 * Cái đầu là nộp URL rác cho Google. Cái sau nặng hơn: đó là chỗ người dùng bị
 * đẩy về SAU KHI TRẢ TIỀN.
 *
 * Không sửa `main.ts` cho khớp được — CORS cần cả danh sách, đó là đúng. Nên
 * quy ước là: **phần tử ĐẦU TIÊN là địa chỉ chính**, và mọi nơi cần một địa chỉ
 * thì gọi hàm này thay vì tự đọc biến.
 *
 * Cắt luôn dấu `/` thừa ở cuối: chỗ gọi đều nối `${goc}/duong-dan`, nên
 * `SITE_URL` kết thúc bằng `/` sẽ ra `//duong-dan`.
 */
export function siteUrlChinh(raw?: string | null): string {
  const dau = (raw ?? '').split(',')[0].trim();
  return (dau || 'http://localhost:3001').replace(/\/+$/, '');
}
