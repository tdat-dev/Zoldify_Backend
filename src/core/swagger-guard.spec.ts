import { choPhepXemTaiLieu } from './swagger-guard';

/**
 * Chặn `/api/docs` — bài kiểm viết TRƯỚC.
 *
 * TÌNH TRẠNG TRƯỚC KHI SỬA, đo bằng curl:
 *
 *   https://api-staging.zoldify.com/api/docs       200
 *   https://api-staging.zoldify.com/api/docs-json  200
 *   https://api.zoldify.com/api/docs               200
 *
 * Tức là toàn bộ 98 route và 62 schema — gồm cả đường quản trị, đường tiền, và
 * hình dạng mọi tham số — mở cho bất kỳ ai. Đây không phải lỗ hổng tự nó, nhưng
 * nó là **tấm bản đồ** cho người muốn tìm lỗ hổng: khỏi phải dò, cứ đọc.
 *
 * BA HOÀN CẢNH, VÀ VÌ SAO QUY TẮC PHẢI THẾ NÀY.
 *
 * Cách hiển nhiên là "tắt khi NODE_ENV=production". Nhưng như thế thì an toàn
 * phụ thuộc vào MỘT biến môi trường đặt đúng — đặt sót một chỗ là hở mà không
 * ai biết. Nên quy tắc ở đây **hỏng về phía đóng**:
 *
 *   1. Có đặt tài khoản  → bắt đăng nhập, ai cũng xem được nếu biết mật khẩu.
 *   2. Không đặt, gọi từ chính máy đang chạy → cho xem. Máy cá nhân không cần
 *      mật khẩu, và người ngoài không giả được địa chỉ loopback.
 *   3. Không đặt, gọi từ xa → **từ chối**. Không cần biết NODE_ENV là gì.
 *
 * Trả 404 chứ không 401: 401 là xác nhận "có tài liệu ở đây, mời thử mật khẩu".
 * 404 thì không nói gì cả.
 */
describe('choPhepXemTaiLieu', () => {
  const KHONG_TK = { user: '', pass: '' };
  const CO_TK = { user: 'admin', pass: 'mat-khau-dai' };

  const basic = (u: string, p: string) =>
    'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

  it('có tài khoản + đúng mật khẩu → cho xem', () => {
    expect(
      choPhepXemTaiLieu(CO_TK, basic('admin', 'mat-khau-dai'), '203.0.113.9'),
    ).toBe('cho');
  });

  it('có tài khoản + SAI mật khẩu → đòi đăng nhập', () => {
    expect(choPhepXemTaiLieu(CO_TK, basic('admin', 'sai'), '203.0.113.9')).toBe(
      'doi-dang-nhap',
    );
  });

  it('có tài khoản + không gửi gì → đòi đăng nhập', () => {
    expect(choPhepXemTaiLieu(CO_TK, undefined, '203.0.113.9')).toBe(
      'doi-dang-nhap',
    );
  });

  it('có tài khoản thì loopback CŨNG phải đăng nhập', () => {
    // Đặt mật khẩu rồi thì nó áp cho tất cả. Chừa cửa cho loopback ở đây là mở
    // đường cho bất kỳ tiến trình nào trên cùng máy chủ.
    expect(choPhepXemTaiLieu(CO_TK, undefined, '127.0.0.1')).toBe(
      'doi-dang-nhap',
    );
  });

  it('KHÔNG đặt tài khoản + gọi từ máy đang chạy → cho xem', () => {
    // Máy cá nhân: `npm run start:dev` rồi mở localhost. Bắt đặt mật khẩu ở đây
    // là làm phiền mà không được gì — người ngoài không giả được loopback.
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']) {
      expect(choPhepXemTaiLieu(KHONG_TK, undefined, ip)).toBe('cho');
    }
  });

  it('KHÔNG đặt tài khoản + gọi TỪ XA → từ chối, và trả 404', () => {
    // Đây là chỗ đang hở trên staging và production. Từ chối mà KHÔNG phụ thuộc
    // NODE_ENV: an toàn không nên treo vào một biến môi trường đặt đúng.
    expect(choPhepXemTaiLieu(KHONG_TK, undefined, '203.0.113.9')).toBe('giau');
  });

  it('mật khẩu quá ngắn coi như KHÔNG đặt — không nhận mật khẩu hình thức', () => {
    // Đặt `SWAGGER_PASSWORD=1` rồi tưởng mình đã khoá cửa là tệ hơn không khoá,
    // vì nó tạo cảm giác an toàn sai.
    expect(
      choPhepXemTaiLieu({ user: 'a', pass: '123' }, undefined, '203.0.113.9'),
    ).toBe('giau');
  });

  it('so mật khẩu không được rò rỉ độ dài qua thời gian', () => {
    // Không đo được thời gian trong bài kiểm đơn vị, nhưng khẳng định được rằng
    // mật khẩu dài ngắn khác nhau đều bị từ chối gọn ghẽ, không ném lỗi.
    expect(() =>
      choPhepXemTaiLieu(CO_TK, basic('admin', 'x'), '203.0.113.9'),
    ).not.toThrow();
    expect(
      choPhepXemTaiLieu(CO_TK, basic('admin', 'x'.repeat(500)), '203.0.113.9'),
    ).toBe('doi-dang-nhap');
  });

  it('header rác không làm sập, chỉ bị từ chối', () => {
    for (const rac of [
      'Basic',
      'Basic !!!',
      'Bearer abc',
      '',
      'Basic ' + 'A'.repeat(9999),
    ]) {
      expect(() => choPhepXemTaiLieu(CO_TK, rac, '203.0.113.9')).not.toThrow();
      expect(choPhepXemTaiLieu(CO_TK, rac, '203.0.113.9')).toBe(
        'doi-dang-nhap',
      );
    }
  });
});
