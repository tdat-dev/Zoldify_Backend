/**
 * Khuôn phân trang dùng chung.
 *
 * Mọi service trả danh sách trong dự án đều dùng đúng hình dạng này:
 *   { meta: { current, pageSize, pages, total }, result: [...] }
 *
 * Khai báo ở một chỗ để web và app sinh ra cùng một kiểu, thay vì mỗi
 * endpoint tự mô tả lại rồi lệch nhau.
 */
export class PaginationMetaDto {
  /** Trang hiện tại, bắt đầu từ 1 */
  current: number;

  /** Số bản ghi mỗi trang */
  pageSize: number;

  /** Tổng số trang */
  pages: number;

  /** Tổng số bản ghi khớp điều kiện lọc */
  total: number;
}
