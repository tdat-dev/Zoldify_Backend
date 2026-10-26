import { PartialType } from '@nestjs/mapped-types';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class UpdateProductDto extends PartialType(CreateProductDto) {
  /**
   * Số tồn kho client ĐANG HIỂN THỊ lúc người bán mở form sửa.
   *
   * Có trường này thì đổi `stock` chỉ thành công khi kho thật vẫn bằng nó, tức
   * khoá lạc quan phủ trọn từ lúc tải trang tới lúc bấm lưu. Không gửi thì
   * server lấy số vừa đọc trong chính request, chỉ phủ được khe vài mili giây
   * giữa lúc đọc và lúc ghi. Xem `ProductsService.update`.
   */
  @IsOptional()
  @IsInt({ message: 'expected_stock phải là số nguyên' })
  @Min(0, { message: 'expected_stock không được âm' })
  expected_stock?: number;
}
