import { IsEnum } from 'class-validator';
import { PaymentMethod } from '@common/enums/payment.enum';

/** Cách trả mới; service chỉ nhận COD, ví, PayOS (change-payment-method.ts). */
export class ChangePaymentMethodDto {
  @IsEnum(PaymentMethod, { message: 'Phương thức thanh toán không hợp lệ' })
  payment_method: PaymentMethod;
}
