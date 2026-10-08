/**
 * Địa chỉ công khai của máy chủ — LẤY TỪ CẤU HÌNH, không lấy từ request.
 *
 * VÌ SAO CÓ FILE NÀY.
 *
 * `files.controller.ts` dựng URL cho tệp vừa tải lên bằng:
 *
 *     url = `${req.protocol}://${req.get('host')}/public/images/...`
 *
 * `Host` là header do NGƯỜI GỬI đặt. Và URL này không chỉ được trả về một lần —
 * nó được **lưu vào bảng `files`** rồi phục vụ cho mọi người xem sau đó.
 *
 * Nên một lần tải ảnh kèm `Host: evil.example` là ghi vào database một địa chỉ
 * trỏ sang máy chủ người khác, và mọi người xem ảnh đó về sau đều bị dẫn tới
 * đó. Người bán tải ảnh sản phẩm, người mua nhìn thấy ảnh lấy từ `evil`.
 *
 * Đứng sau proxy còn một mặt nữa: `Host` khi đó thường là tên nội bộ của
 * container, nên URL lưu xuống không ai ngoài mạng nội bộ mở được. Đây là
 * task #13 trong `docs/BAN-GIAO.md`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * VÌ SAO KHÔNG LƯU ĐƯỜNG DẪN TƯƠNG ĐỐI. Trông có vẻ gọn hơn, nhưng
 * `/public/images/x.jpg` ở trình duyệt sẽ phân giải theo origin của TRANG WEB,
 * không phải của API. Web chạy ở `zoldify.com` còn ảnh nằm ở `api.zoldify.com`
 * — ảnh sẽ hỏng ở cả ba client. Và dữ liệu cũ trong bảng `files` là URL tuyệt
 * đối, nên đổi kiểu là phải viết migration chuyển đổi.
 *
 * VÌ SAO CHỮ KÝ KHÔNG NHẬN `req`. Để không ai lỡ tay truyền header vào được.
 * Cách chắc chắn nhất để một thứ không lọt vào là không có cửa cho nó đi.
 */

/** Chỉ phần cấu hình mà hai hàm dưới cần — nhận vào để kiểm được, khỏi mock `process.env`. */
export interface CauHinhGoc {
  /** Tên miền CDN phục vụ ảnh, ví dụ `https://img.zoldify.com`. */
  CDN_BASE_URL?: string;
  /** Địa chỉ công khai của chính API, ví dụ `https://api.zoldify.com`. */
  API_PUBLIC_URL?: string;
  PORT?: string;
}

/**
 * Gốc URL công khai, theo thứ tự ưu tiên:
 *
 *   1. `CDN_BASE_URL`     — có CDN thì ảnh nên đi qua CDN
 *   2. `API_PUBLIC_URL`   — không CDN thì chính API phục vụ `public/`
 *   3. `http://localhost:PORT` — máy dev, không phải cấu hình gì vẫn chạy
 *
 * Cắt dấu `/` thừa ở cuối vì chỗ gọi đều nối `${gốc}/đường-dẫn`.
 *
 * Chỉ lấy phần tử đầu nếu gặp danh sách ngăn bởi dấu phẩy — cùng bẫy mà
 * `site-url.ts` đã kể: `SITE_URL` là danh sách origin cho CORS, và hai chỗ
 * từng đọc thẳng nó rồi nối đường dẫn, sinh ra
 * `https://staging.zoldify.com,https://admin-staging.zoldify.com/payment/return`.
 * Ai đó điền `CDN_BASE_URL` theo thói quen ấy thì phải hỏng về phía an toàn.
 */
export function gocCongKhai(env: CauHinhGoc): string {
  const thoo = env.CDN_BASE_URL ?? env.API_PUBLIC_URL ?? '';
  const dau = thoo.split(',')[0].trim();
  if (dau) return dau.replace(/\/+$/, '');
  return `http://localhost:${env.PORT || '3000'}`;
}

/**
 * URL công khai của một tệp trong `public/images/<folder>/<filename>`.
 *
 * Có CDN thì bỏ tiền tố `/public`: bucket R2 phục vụ thẳng từ gốc tên miền,
 * `img.zoldify.com/images/...` chứ không phải `img.zoldify.com/public/images/...`.
 */
export function urlTepCongKhai(
  env: CauHinhGoc,
  folder: string,
  filename: string,
): string {
  const goc = gocCongKhai(env);
  const tienTo = env.CDN_BASE_URL ? '' : '/public';
  return `${goc}${tienTo}/images/${folder}/${filename}`;
}
