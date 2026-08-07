import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  @IsString({ message: 'Tên sản phẩm phải là chuỗi' })
  name: string;

  @IsNotEmpty({ message: 'Giá sản phẩm không được để trống' })
  @IsNumber({}, { message: 'Giá sản phẩm phải là số' })
  price: number;

  @IsOptional({ message: 'Ảnh sản phẩm không được để trống' })
  @IsString({ message: 'Ảnh sản phẩm phải là chuỗi' })
  image?: string;

  @IsOptional({ message: 'Mô tả sản phẩm không được để trống' })
  @IsString({ message: 'Mô tả sản phẩm phải là chuỗi' })
  description?: string;

  @IsOptional({ message: 'Slug sản phẩm không được để trống' })
  @IsString({ message: 'Slug sản phẩm phải là chuỗi' })
  slug?: string;

  @IsNotEmpty({ message: 'Danh mục sản phẩm không được để trống' })
  @IsNumber({}, { message: 'Danh mục sản phẩm phải là số' })
  category_id: number;

  @IsOptional({ message: 'Thương hiệu sản phẩm không được để trống' })
  @IsString({ message: 'Thương hiệu sản phẩm phải là chuỗi' })
  brand?: string;

  @IsOptional({ message: 'Thông số kỹ thuật sản phẩm không được để trống' })
  @IsString({ message: 'Thông số kỹ thuật sản phẩm phải là chuỗi' })
  spec?: string;

  @IsOptional({ message: 'Số lượng (stock) không được để trống' })
  @IsNumber({}, { message: 'Số lượng (stock) phải là số' })
  stock?: number;

  @IsOptional()
  images?: string[];

  @IsOptional()
  @IsString()
  condition?: string;  // new | like_new | good | fair

  @IsOptional()
  is_freeship?: boolean;
}
