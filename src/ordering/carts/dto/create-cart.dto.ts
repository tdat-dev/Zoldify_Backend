import { IsInt, IsNotEmpty, Min, IsOptional } from 'class-validator';

export class CreateCartDto {
  @IsNotEmpty({ message: 'Mã sản phẩm (product_id) không được để trống' })
  @IsInt({ message: 'Mã sản phẩm phải là số nguyên' })
  product_id: number;

  @IsOptional()
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, { message: 'Số lượng ít nhất phải là 1' })
  quantity?: number;
}
