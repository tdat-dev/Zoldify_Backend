import { IsOptional, IsInt, IsString, Min, Max, IsArray } from 'class-validator';

export class UpdateReviewDto {
  @IsOptional()
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
