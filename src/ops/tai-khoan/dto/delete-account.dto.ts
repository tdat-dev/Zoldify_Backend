import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  /**
   * Mật khẩu hiện tại. BẮT BUỘC với tài khoản có mật khẩu; tài khoản chỉ đăng
   * nhập bằng Google (chưa từng đặt mật khẩu) thì bỏ trống.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}
