import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class TopupDto {
  @IsNumber()
  @Min(1000)
  amount: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
