import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  @IsString({ message: 'Tên sản phẩm phải là chuỗi' })
  name: string;

  @IsNotEmpty({ message: 'Giá sản phẩm không được để trống' })
  @IsNumber({}, { message: 'Giá sản phẩm phải là số' })
  price: number;

  /**
   * Mã ISO 4217, 3 chữ hoa. Bỏ trống thì entity mặc định 'VND'.
   *
   * Chỉ kiểm HÌNH DẠNG chứ không kiểm mã có thật: danh sách ISO 4217 thay đổi
   * theo thời gian và giữ một bản chép tay ở đây thì sớm muộn cũng lạc hậu.
   * Mã lạ lọt qua sẽ hiện ra ở phần định dạng phía frontend (Intl ném lỗi và
   * rơi về in số kèm mã), chứ không làm hỏng dữ liệu.
   */
  @IsOptional()
  @IsString({ message: 'Đơn vị tiền phải là chuỗi' })
  @Matches(/^[A-Z]{3}$/, {
    message: 'Đơn vị tiền phải là 3 chữ in hoa, ví dụ VND hoặc USD',
  })
  currency?: string;

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
  condition?: string; // new | like_new | good | fair

  @IsOptional()
  is_freeship?: boolean;
}
