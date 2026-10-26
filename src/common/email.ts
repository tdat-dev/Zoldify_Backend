import { applyDecorators, BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, Matches } from 'class-validator';

/**
 * CHUẨN HOÁ EMAIL: một chỗ, dùng cho MỌI cửa vào nhận email của luồng xác thực
 * (đăng ký gửi/xác nhận OTP, đăng nhập, quên mật khẩu gửi/đặt lại, Firebase).
 *
 * VÌ SAO, KỂ LẠI CÁI BẪY.
 *
 * Cột users.email dùng collation utf8mb4_unicode_ci: KHÔNG phân biệt hoa
 * thường và KHÔNG phân biệt dấu. `@IsEmail` của class-validator nhận tên miền
 * Unicode (đo 25/10: isEmail('victim@gmaïl.com') === true). Ghép lại:
 *   1. kẻ xấu sở hữu tên miền IDN gmaïl.com (punycode xn--gmal-7pa.com);
 *   2. gọi quên mật khẩu với victim@gmaïl.com;
 *   3. findOne({ email }) khớp victim@gmail.com nhờ collation bỏ dấu;
 *   4. OTP gửi tới địa chỉ GÕ VÀO, tức hộp thư của kẻ xấu;
 *   5. đặt lại mật khẩu, email_verified = true: chiếm trọn tài khoản.
 * Cùng mẹo đó chiếm trước qua đăng ký OTP rồi chờ chủ thật đăng nhập Google.
 *
 * Cách chặn ở đây: trim, NFKC (chữ toàn độ rộng "ｇｍａｉｌ" về "gmail"), chữ
 * thường, rồi TỪ CHỐI mọi email còn ký tự ngoài ASCII. Không có người dùng thật
 * nào của sàn cần email Unicode, còn cho phép thì collation bỏ dấu biến mọi ký
 * tự có dấu thành một lối đi tắt.
 *
 * NỢ: collation của cột vẫn là utf8mb4_unicode_ci (không đổi trong đợt này vì
 * cần migration và rà dữ liệu cũ). Đổi sang utf8mb4_bin hoặc ascii_general_ci
 * thì lớp này thành lớp chặn thứ hai thay vì duy nhất.
 */
export function chuanHoaEmail(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  return raw.trim().normalize('NFKC').toLowerCase();
}

/** Ký tự in được của ASCII, không khoảng trắng. */
const CHI_ASCII = /^[\x21-\x7e]+$/;

export const LOI_EMAIL_KHONG_ASCII =
  'Email chỉ được chứa ký tự Latin không dấu (ASCII)';

/**
 * Decorator cho trường email trong DTO: chuẩn hoá trước, rồi mới kiểm. Phải là
 * Transform (chạy trước validator vì ValidationPipe bật transform) chứ không
 * chuẩn hoá trong service: " A@B.com" bị IsEmail từ chối trước khi tới service.
 */
export function EmailChuanHoa(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => chuanHoaEmail(value)),
    Matches(CHI_ASCII, { message: LOI_EMAIL_KHONG_ASCII }),
    IsEmail({}, { message: 'Email không hợp lệ' }),
  );
}

/**
 * Bản dùng trong service, cho các đường không đi qua DTO (LocalStrategy chạy
 * TRƯỚC ValidationPipe, vì guard chạy trước pipe) hoặc khi hàm bị gọi thẳng.
 * Ném 400 thay vì trả chuỗi rỗng: im lặng nuốt lỗi ở đây là để collation
 * quyết định thay mình.
 */
export function emailChuanHoaHoacLoi(raw: unknown): string {
  const e = chuanHoaEmail(raw);
  if (typeof e !== 'string' || !e) {
    throw new BadRequestException('Email không được để trống');
  }
  if (!CHI_ASCII.test(e)) {
    throw new BadRequestException(LOI_EMAIL_KHONG_ASCII);
  }
  return e;
}
