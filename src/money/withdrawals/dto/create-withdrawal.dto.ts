import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsNumber()
  @Min(10000, { message: 'Số tiền rút tối thiểu là 10,000đ' })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'Tên ngân hàng không được để trống' })
  bank_name: string;

  @IsString()
  @IsNotEmpty({ message: 'Số tài khoản không được để trống' })
  bank_account: string;

  @IsString()
  @IsNotEmpty({ message: 'Chủ tài khoản không được để trống' })
  bank_holder: string;
}