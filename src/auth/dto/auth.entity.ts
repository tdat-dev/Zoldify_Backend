import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

// 1. Luồng Quên mật khẩu - Bước 1: Gửi OTP
export class SendOtpDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;
}

// 1. Luồng Quên mật khẩu - Bước 2: Xác thực & Đặt lại mật khẩu
export class ResetPasswordDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
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
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  full_name: string;
}

// Luồng Đăng ký - Bước 2: Xác thực OTP + tạo tài khoản
export class VerifyRegisterOtpDto {
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Mã OTP không được để trống' })
  otp: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password: string;
}

// 2. Luồng Thay đổi mật khẩu (Khi đã đăng nhập)
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Mật khẩu cũ không được để trống' })
  oldPassword: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu mới phải có ít nhất 6 ký tự' })
  newPassword: string;
}