import { IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderDto {
  @IsOptional()
  @IsBoolean({ message: 'Trạng thái thanh toán phải là boolean' })
  is_paid?: boolean;
  @IsOptional()
  @IsEnum(OrderStatus, { message: 'Trạng thái đơn hàng không hợp lệ' })
  status: OrderStatus;

  @IsOptional()
  @IsString({ message: 'Mã vận đơn phải là chuỗi' })
  tracking_code: string;

  @IsOptional()
  @IsString({ message: 'Địa chỉ giao hàng phải là chuỗi' })
  shipping_address: string;

  @IsOptional()
  @IsString({ message: 'Tên người nhận phải là chuỗi' })
  receiver_name: string;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi' })
  receiver_phone: string;

  @IsOptional()
  @IsString({ message: 'Tỉnh/Thành phố phải là chuỗi' })
  province: string;

  @IsOptional()
  @IsString({ message: 'Quận/Huyện phải là chuỗi' })
  district: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi' })
  note: string;
}
