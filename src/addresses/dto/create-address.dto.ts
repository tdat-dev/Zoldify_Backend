import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty({ message: 'Tên người nhận không được để trống' })
  recipient_name: string;

  @IsString()
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  phone_number: string;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsNotEmpty({ message: 'Tỉnh/Thành phố không được để trống' })
  province: string;

  @IsString()
  @IsNotEmpty({ message: 'Quận/Huyện không được để trống' })
  district: string;

  @IsString()
  @IsOptional()
  ward?: string;

  @IsString()
  @IsNotEmpty({ message: 'Địa chỉ chi tiết không được để trống' })
  street: string;

  @IsBoolean()
  @IsOptional()
  is_default?: boolean;
}

export class UpdateAddressDto {
  @IsString()
  @IsOptional()
  recipient_name?: string;

  @IsString()
  @IsOptional()
  phone_number?: string;

  @IsString()
  @IsOptional()
  label?: string;

  @IsString()
  @IsOptional()
  province?: string;

  @IsString()
  @IsOptional()
  district?: string;

  @IsString()
  @IsOptional()
  ward?: string;

  @IsString()
  @IsOptional()
  street?: string;

  @IsBoolean()
  @IsOptional()
  is_default?: boolean;
}
