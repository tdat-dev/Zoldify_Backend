import { IsNotEmpty, IsInt, IsOptional, IsString, Min, Max, IsArray } from 'class-validator';

export class CreateReviewDto {
  @IsNotEmpty({ message: 'Mã sản phẩm không được để trống' })
  @IsInt({ message: 'Mã sản phẩm phải là số nguyên' })
  product_id: number;

  @IsNotEmpty({ message: 'Mã đơn hàng không được để trống' })
  @IsInt({ message: 'Mã đơn hàng phải là số nguyên' })
  order_id: number;

  @IsNotEmpty({ message: 'Số sao đánh giá không được để trống' })
  @IsInt({ message: 'Số sao phải là số nguyên' })
  @Min(1, { message: 'Số sao tối thiểu là 1' })
  @Max(5, { message: 'Số sao tối đa là 5' })
  rating: number;

  @IsOptional()
  @IsString({ message: 'Nội dung đánh giá phải là chuỗi' })
  comment: string;

  @IsOptional()
  @IsArray({ message: 'Ảnh đính kèm phải là mảng' })
  images: string[];
}
