import { IsOptional, IsString, Length, IsBoolean } from 'class-validator';

/**
 * DTO cho `PATCH /admin/users/:id` — chỉ cho phép sửa các cột an toàn.
 *
 * KHÔNG cho phép: password, role, token_version, is_locked, refresh_token
 * — ba cái sau đã có route riêng (toggle-lock, role, delete), và password
 * phải đổi qua luồng đổi mật khẩu có xác thực cũ.
 */
export class UpdateUserByAdminDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  full_name?: string;

  @IsOptional()
  @IsString()
  @Length(8, 20)
  phone_number?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsBoolean()
  email_verified?: boolean;
}
