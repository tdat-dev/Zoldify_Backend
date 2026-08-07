import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class TransferDto {
  @IsNumber()
  @IsNotEmpty()
  to_user_id: number;

  @IsNumber()
  @Min(1000)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
