import { gocCongKhai, urlTepCongKhai } from './public-url';

/**
 * BÀI KIỂM ĐỎ — địa chỉ tệp tải lên KHÔNG được dựng từ header của client.
 *
 * `files.controller.ts` đang ghép:
 *
 *     url = `${req.protocol}://${req.get('host')}/public/images/...`
 *
 * `Host` là header do NGƯỜI GỬI đặt. Và URL này không chỉ được trả về một lần —
 * nó được **lưu vào bảng `files`** rồi phục vụ cho mọi người xem sau đó.
 *
 * Nên một lần tải ảnh kèm `Host: evil.example` là ghi vào database một địa chỉ
 * trỏ sang máy chủ của người khác, và mọi người xem ảnh đó về sau đều bị dẫn
 * tới đó. Người bán tải ảnh sản phẩm, người mua nhìn thấy ảnh lấy từ evil.
 *
 * Đứng sau proxy còn một mặt nữa: `Host` khi đó là tên nội bộ của container,
 * nên URL lưu xuống không ai ngoài mạng nội bộ mở được.
 *
 * Địa chỉ công khai là **cấu hình của máy chủ**, không phải thứ client khai báo.
 */
describe('gocCongKhai — gốc URL công khai lấy từ cấu hình', () => {
  it('ưu tiên CDN_BASE_URL khi có', () => {
    expect(
      gocCongKhai({
        CDN_BASE_URL: 'https://img.zoldify.com',
        API_PUBLIC_URL: 'https://api.zoldify.com',
      }),
    ).toBe('https://img.zoldify.com');
  });

  it('không có CDN thì dùng API_PUBLIC_URL', () => {
    expect(gocCongKhai({ API_PUBLIC_URL: 'https://api.zoldify.com' })).toBe(
      'https://api.zoldify.com',
    );
  });

  it('không có gì thì về localhost theo PORT — đủ chạy máy dev', () => {
    expect(gocCongKhai({ PORT: '3000' })).toBe('http://localhost:3000');
    expect(gocCongKhai({})).toBe('http://localhost:3000');
  });

  it('cắt dấu / thừa ở cuối — chỗ gọi đều nối `${gốc}/đường-dẫn`', () => {
    expect(gocCongKhai({ CDN_BASE_URL: 'https://img.zoldify.com/' })).toBe(
      'https://img.zoldify.com',
    );
    expect(gocCongKhai({ CDN_BASE_URL: 'https://img.zoldify.com///' })).toBe(
      'https://img.zoldify.com',
    );
  });

  /**
   * Cùng bẫy mà `site-url.ts` đã kể: `SITE_URL` là một DANH SÁCH origin cho
   * CORS, và hai chỗ từng đọc thẳng nó rồi nối đường dẫn vào sau, sinh ra
   * `https://staging.zoldify.com,https://admin-staging.zoldify.com/payment/return`.
   * Nếu ai đó điền `CDN_BASE_URL` theo thói quen đó thì phải hỏng về phía an
   * toàn, không phải sinh ra URL rác.
   */
  it('chỉ lấy phần tử đầu nếu ai đó điền cả danh sách ngăn bởi dấu phẩy', () => {
    expect(
      gocCongKhai({ CDN_BASE_URL: 'https://img.zoldify.com,https://x.com' }),
    ).toBe('https://img.zoldify.com');
  });
});

describe('urlTepCongKhai — ghép đường dẫn tệp', () => {
  it('ghép đúng thư mục và tên tệp', () => {
    expect(
      urlTepCongKhai(
        { API_PUBLIC_URL: 'https://api.zoldify.com' },
        'products',
        'a.jpg',
      ),
    ).toBe('https://api.zoldify.com/public/images/products/a.jpg');
  });

  it('CDN thì bỏ tiền tố /public — bucket phục vụ thẳng từ gốc', () => {
    expect(
      urlTepCongKhai(
        { CDN_BASE_URL: 'https://img.zoldify.com' },
        'products',
        'a.jpg',
      ),
    ).toBe('https://img.zoldify.com/images/products/a.jpg');
  });

  it('KHÔNG nhận bất cứ thứ gì từ request', () => {
    // Chữ ký hàm chỉ có (env, folder, filename). Không có chỗ nào truyền
    // `req` vào được — đó là cách chắc chắn nhất để header của client không
    // lọt vào URL lưu xuống database.
    expect(urlTepCongKhai.length).toBe(3);
  });
});
