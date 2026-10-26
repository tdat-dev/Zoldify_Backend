import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body của PATCH /users/:id (admin). CHỈ các cột hồ sơ.
 *
 * Bản trước là PartialType(CreateUserDto), tức nhận cả password, role, email.
 * UsersService.update ghi thẳng DTO xuống bảng: password lưu nguyên văn không
 * băm (tài khoản không đăng nhập được nữa và mật khẩu nằm trần trong DB), role
 * đổi được mà không tăng token_version, đi vòng qua route đổi vai trò riêng
 * PATCH /admin/users/:id/role. Đổi mật khẩu đi qua luồng auth; đổi vai trò đi
 * qua AdminService.changeUserRole; email là định danh đăng nhập, không sửa ở
 * đây.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone_number?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  gender?: string;
}

/** Cột UsersService.update được phép ghi, dùng để lọc lại khi gọi thẳng. */
export const COT_SUA_DUOC: Array<keyof UpdateUserDto> = [
  'full_name',
  'phone_number',
  'avatar',
  'gender',
];
