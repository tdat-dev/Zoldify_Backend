import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRole } from '../entities/user.entity';

export class CreateUserDto {
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @IsString()
  full_name: string;

  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email: string;

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu tối thiểu 6 ký tự' })
  password: string;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'Email không hợp lệ' })
  role?: UserRole;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  gender?: string;
}

export class RegisterUserDto {
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @IsString({ message: 'Họ tên không được để trống' })
  full_name: string;

  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Đây không phải là một email' })
  email: string;

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu tối thiểu 6 ký tự' })
  password: string;

  @IsOptional({ message: 'Số điện thoại không được để trống' })
  @IsString({ message: 'Số điện thoại không hợp lệ' })
  phone_number?: string;

  // KHÔNG có `role` ở đây, và đó là chủ ý.
  //
  // Trước 06/10 lớp này có `@IsOptional() @IsEnum(UserRole) role?: UserRole`.
  // Route `POST /auth/register` là `@Public()`, nên bất kỳ ai gửi
  // `{"role":"admin"}` là tạo thẳng một tài khoản quản trị.
  //
  // `ValidationPipe` dùng `whitelist: true` KHÔNG cứu được: whitelist chỉ loại
  // trường không có decorator. `role` có decorator nên nó được giữ nguyên rồi
  // đi tiếp xuống `UsersService.register`.
  //
  // Muốn đổi vai trò thì đi đường riêng có kiểm quyền:
  // `PATCH /admin/users/:id/role` (AdminGuard + ChangeRoleDto).
  //
  // `UsersService.register` còn gán cứng BUYER một lần nữa — hai lớp, vì một
  // lớp thì lớp kia hỏng là hở. `register-role.spec.ts` gác cả hai.
}

export class LoginUserDto {
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Đây không phải là một email' })
  email: string;

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu tối thiểu 6 ký tự' })
  password: string;
}
