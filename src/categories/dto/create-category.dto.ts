import { IsNotEmpty, IsOptional, IsString, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ description: 'Tên danh mục', example: 'Điện thoại' })
  @IsNotEmpty({ message: 'Tên danh mục không được để trống' })
  @IsString({ message: 'Tên danh mục phải là chuỗi ký tự' })
  name: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  description?: string;

  @IsOptional()
  @IsString({ message: 'Slug phải là chuỗi ký tự' })
  slug?: string;

  @IsOptional()
  @IsString({ message: 'Ảnh danh mục phải là chuỗi ký tự' })
  image?: string;

  @IsOptional()
  @IsBoolean({ message: 'Trạng thái hoạt động phải là kiểu boolean' })
  is_active?: boolean;
}
