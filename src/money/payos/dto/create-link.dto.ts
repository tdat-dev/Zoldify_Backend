import { IsNotEmpty, IsNumber, IsString, IsOptional, IsEnum, Min } from 'class-validator';

export enum PayosPaymentType {
  ORDER = 'order',
  TOPUP = 'topup',
}

export class CreatePayosLinkDto {
  @IsEnum(PayosPaymentType)
  @IsNotEmpty()
  type: PayosPaymentType;

  // Bắt buộc khi type = 'order'
  @IsOptional()
  @IsNumber()
  order_id?: number;

  // Bắt buộc khi type = 'topup'
  @IsOptional()
  @IsNumber()
  @Min(10000, { message: 'Số tiền nạp tối thiểu 10.000đ' })
  amount?: number;
}

export class CancelPayosLinkDto {
  @IsString()
  @IsNotEmpty()
  payos_order_code: string;
}
