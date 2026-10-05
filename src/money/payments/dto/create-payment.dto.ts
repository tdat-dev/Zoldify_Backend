import { IsNotEmpty, IsInt, IsOptional, IsNumber, Min, IsEnum } from 'class-validator';
import { PaymentMethod } from '@common/enums/payment.enum';

export class CreatePaymentDto {
  @IsOptional()
  @IsInt({ message: 'Mã đơn hàng phải là số nguyên' })
  order_id?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số tiền phải là số' })
  @Min(1000, { message: 'Số tiền tối thiểu là 1,000' })
  amount?:    number;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Phương thức thanh toán không hợp lệ' })
  payment_method?: PaymentMethod;
}
