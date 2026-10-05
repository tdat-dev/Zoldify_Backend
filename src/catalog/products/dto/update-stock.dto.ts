import { IsInt, Min } from 'class-validator';

export class UpdateStockDto {
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(0, { message: 'Số lượng không được âm' })
  stock: number;
}
