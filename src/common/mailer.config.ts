import { ConfigService } from '@nestjs/config';

/**
 * Cấu hình gửi mail — nguồn DUY NHẤT.
 *
 * Trước đây khối này được chép tay vào hai chỗ (app.module và auth.module) và
 * hai bản đã lệch nhau: bản trong auth.module thiếu `defaults.from`, mà đúng
 * bản đó mới là bản AuthService dùng để gửi OTP. Kết quả là mail đăng ký không
 * có người gửi dù SMTP điền đúng. Chép tay hai lần thì sớm muộn cũng lệch, nên
 * cả hai chỗ nay gọi vào đây.
 *
 * VÌ SAO TÁCH `EMAIL_FROM` KHỎI `EMAIL_USER`:
 *
 * Hai thứ này KHÔNG phải một. `EMAIL_USER` là tài khoản đăng nhập vào máy chủ
 * SMTP; `EMAIL_FROM` là địa chỉ người nhận nhìn thấy. Gmail cho phép chúng khác
 * nhau qua tính năng "Gửi thư bằng địa chỉ" (Settings > Accounts > Send mail
 * as): xác minh xong một bí danh thì đăng nhập bằng tài khoản gốc vẫn đặt được
 * From là bí danh đó.
 *
 * Bản cũ dựng From từ chính EMAIL_USER, nên một tên miền riêng đã xác minh vẫn
 * không dùng được: hoặc là điền tên miền vào EMAIL_USER và không đăng nhập
 * được, hoặc là điền Gmail vào và người nhận thấy Gmail cá nhân.
 *
 * ⚠️ Đặt From sang tên miền riêng thì tên miền đó PHẢI cho phép Google gửi thay,
 * không thì SPF trượt và thư rơi vào spam. Bản ghi TXT của tên miền cần có
 * `include:_spf.google.com`.
 */
export function mailerConfig(configService: ConfigService) {
  const user = configService.get<string>('EMAIL_USER');
  // Chưa khai EMAIL_FROM thì gửi bằng chính tài khoản đăng nhập — luôn hợp lệ,
  // chỉ là không đẹp. Không bao giờ để trống, vì thiếu From là nodemailer ném
  // lỗi ngay ở khâu dựng phong bì.
  const from = configService.get<string>('EMAIL_FROM') || user;

  return {
    transport: {
      host: configService.get<string>('EMAIL_HOST') || 'smtp.gmail.com',
      port: Number(configService.get('EMAIL_PORT')) || 587,
      // Cổng 465 nói SMTP qua TLS ngay từ đầu; 587 mở trần rồi nâng cấp bằng
      // STARTTLS. Đặt cứng `secure: false` như bản cũ thì ai chuyển sang 465
      // sẽ treo cho tới lúc hết giờ, không có thông báo nào.
      secure: Number(configService.get('EMAIL_PORT')) === 465,
      auth: { user, pass: configService.get<string>('EMAIL_APP_PASSWORD') },
    },
    defaults: { from: `"Zoldify" <${from}>` },
  };
}
