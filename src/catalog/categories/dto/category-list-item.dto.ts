/**
 * Một dòng trong danh sách danh mục.
 *
 * KHÔNG phải cả entity Category. Endpoint danh sách dùng query builder chọn
 * đúng 7 field rồi ghép thêm product_count tính bằng COUNT, nên nó không có
 * quan hệ `products` lẫn các cột thời gian.
 *
 * `product_count` không phải cột trong bảng — khai ở đây để hợp đồng nói
 * đúng thứ backend thật sự trả về. Web đang dựa vào field này.
 */
export class CategoryListItemDto {
  id: number;
  name: string;
  image: string;
  description: string;
  slug: string;
  is_active: boolean;

  /** Số sản phẩm đang thuộc danh mục, tính lúc truy vấn */
  product_count: number;
}
