import { IsNotEmpty, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateConversationDto {
  @IsNotEmpty({ message: 'Mã người bán không được để trống' })
  @IsInt({ message: 'Mã người bán phải là số nguyên' })
  seller_id: number;

  @IsNotEmpty({ message: 'Mã sản phẩm không được để trống' })
  @IsInt({ message: 'Mã sản phẩm phải là số nguyên' })
  product_id: number;
}
