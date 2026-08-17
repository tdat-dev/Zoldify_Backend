import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

/** Xin báo giá phí ship theo từng người bán cho một địa chỉ nhận (GHN). */
export class ShippingQuoteDto {
  @IsInt()
  @IsNotEmpty()
  to_district_id: number;

  @IsString()
  @IsNotEmpty()
  to_ward_code: string;

  // Giới hạn báo giá ở các món được chọn; bỏ trống thì tính cả giỏ.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  cart_item_ids?: number[];
}
