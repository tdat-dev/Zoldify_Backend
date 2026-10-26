import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateStockDto {
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(0, { message: 'Số lượng không được âm' })
  stock: number;

  /**
   * Số tồn kho client đang hiển thị. `ProductsService.updateStock` đã nhận
   * tham số này từ lâu nhưng controller chưa bao giờ truyền xuống, nên khoá
   * lạc quan chỉ phủ khe trong một request. Gửi kèm thì phủ cả lúc trang mở.
   */
  @IsOptional()
  @IsInt({ message: 'expected_stock phải là số nguyên' })
  @Min(0, { message: 'expected_stock không được âm' })
  expected_stock?: number;
}
