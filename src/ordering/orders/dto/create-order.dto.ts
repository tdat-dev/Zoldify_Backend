import { IsNotEmpty, IsString, IsOptional, IsEnum, IsNumber, Min, IsInt, IsArray } from 'class-validator';
import { PaymentMethod } from '@common/enums/payment.enum';

export class CreateOrderDto {
  @IsNotEmpty({ message: 'Địa chỉ giao hàng không được để trống' })
  @IsString({ message: 'Địa chỉ giao hàng phải là chuỗi' })
  shipping_address: string;

  @IsNotEmpty({ message: 'Tên người nhận không được để trống' })
  @IsString({ message: 'Tên người nhận phải là chuỗi' })
  receiver_name: string;

  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @IsString({ message: 'Số điện thoại phải là chuỗi' })
  receiver_phone: string;

  @IsOptional()
  @IsString({ message: 'Tỉnh/Thành phố phải là chuỗi' })
  province?: string;

  @IsOptional()
  @IsString({ message: 'Quận/Huyện phải là chuỗi' })
  district?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi' })
  note?: string;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Phương thức thanh toán không hợp lệ' })
  payment_method?: PaymentMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  shipping_fee?: number;

  @IsOptional()
  @IsInt()
  ghn_district_id?: number;

  @IsOptional()
  @IsString()
  ghn_ward_code?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  cart_item_ids?: number[];
}
