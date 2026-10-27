import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmailChuanHoa } from '@common/email';

// 1. Luồng Quên mật khẩu - Bước 1: Gửi OTP
export class SendOtpDto {
  @EmailChuanHoa()
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;
}

// 1. Luồng Quên mật khẩu - Bước 2: Xác thực & Đặt lại mật khẩu
export class ResetPasswordDto {
  @EmailChuanHoa()
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Mã OTP không được để trống' })
  otp: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  newPassword: string;
}

// Luồng Đăng ký - Bước 1: Gửi OTP
export class SendRegisterOtpDto {
  @EmailChuanHoa()
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  full_name: string;
}

// Luồng Đăng ký - Bước 2: Xác thực OTP + tạo tài khoản
export class VerifyRegisterOtpDto {
  @EmailChuanHoa()
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Mã OTP không được để trống' })
  otp: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password: string;
}

// 2. Luồng Thay đổi / ĐẶT mật khẩu (Khi đã đăng nhập)
// oldPassword optional: tài khoản đăng nhập bằng Google/social CHƯA có mật khẩu
// nên "đặt mật khẩu" lần đầu không cần mật khẩu cũ.
export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  oldPassword?: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  newPassword: string;
}

// 5. Đăng nhập Google qua Firebase. Bản trước đọc `@Body('idToken')` trần:
// không kiểm kiểu, nên body `{ idToken: { ... } }` hay chuỗi rỗng vẫn đi thẳng
// vào firebase-admin. DTO để ValidationPipe chặn ngay ở cửa.
export class FirebaseLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'idToken không được để trống' })
  idToken: string;
}

// 6. Luồng Làm mới access token bằng refresh token
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'Refresh token không được để trống' })
  refreshToken: string;
}

// 7. Đăng xuất. `push_token` tuỳ chọn: token FCM của CHÍNH thiết bị đang đăng
// xuất, để gỡ trong cùng request. App không gỡ sau được nữa vì logout tăng
// token_version, JWT chết ngay, lời gọi DELETE /notifications/push-token đến
// sau nhận 401. Thiếu trường này thì máy đã đăng xuất vẫn nhận thông báo đơn
// của tài khoản cũ.
export class LogoutDto {
  /** Token FCM của thiết bị đang đăng xuất (bỏ trống nếu chưa đăng ký push). */
  @IsOptional()
  @IsString()
  // Cột push_tokens.token là varchar(512); dài hơn thì chắc chắn không có dòng
  // nào để xoá, chặn ở cửa cho khỏi đi xuống database.
  @MaxLength(512)
  push_token?: string;
}
