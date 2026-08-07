import { IsOptional, IsString, IsEnum } from 'class-validator';
import { PaymentStatus } from '@common/enums/payment.enum';

export class UpdatePaymentDto {
  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'Trạng thái thanh toán không hợp lệ' })
  status?: PaymentStatus;

  @IsOptional()
  @IsString({ message: 'Mã giao dịch phải là chuỗi' })
  transaction_code?: string;
}
