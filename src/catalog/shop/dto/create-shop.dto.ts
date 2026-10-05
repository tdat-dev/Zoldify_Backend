import { IsNotEmpty, IsString, IsOptional, IsInt } from 'class-validator';

export class CreateShopDto {
  @IsNotEmpty({ message: 'Tên shop không được để trống' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Slug không được để trống' })
  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  banner?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // Địa chỉ lấy hàng (pickup) cho vận đơn GHN. Lưu cả id lẫn tên vì GHN cần
  // district_id/ward_code khi tính phí và tên tỉnh/quận/phường khi tạo đơn.
  @IsOptional()
  @IsString()
  pickup_name?: string;

  @IsOptional()
  @IsString()
  pickup_phone?: string;

  @IsOptional()
  @IsString()
  pickup_address?: string;

  @IsOptional()
  @IsString()
  pickup_province_name?: string;

  @IsOptional()
  @IsInt()
  pickup_district_id?: number;

  @IsOptional()
  @IsString()
  pickup_district_name?: string;

  @IsOptional()
  @IsString()
  pickup_ward_code?: string;

  @IsOptional()
  @IsString()
  pickup_ward_name?: string;
}
