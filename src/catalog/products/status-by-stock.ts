/**
 * Trạng thái tin đi theo tồn kho: hết hàng là `sold`, có hàng lại là `active`.
 *
 * Trước 12/11 không nơi nào đặt `sold`: bán hết kho mà tin vẫn `active`, nên
 * trang chủ, danh mục và tìm kiếm (đều lọc `status = 'active'`, xếp mới đăng
 * trước) để tin hết hàng nằm trên cùng, và trang shop đếm nó là "đang bán".
 *
 * Không xếp "còn hàng trước" trong câu SELECT: thêm `ORDER BY stock > 0` làm
 * MySQL bỏ index (status, created_at) và sắp lại cả ~1 triệu dòng mỗi lần mở
 * trang. Đổi trạng thái lúc GHI kho thì danh sách vẫn đi index như cũ.
 *
 * Là biểu thức SQL để gắn vào CHÍNH câu UPDATE đổi kho, đặt SAU cột `stock`:
 * MySQL tính các phép gán của UPDATE một bảng từ trái sang phải, nên `stock`
 * ở đây đã là số mới. Không đọc rồi ghi riêng một câu: hai đơn đặt cùng lúc sẽ
 * thấy kho cũ và để lọt trạng thái sai.
 *
 * Chỉ chạm `active` và `sold`. Tin nháp, chờ duyệt, bị từ chối hay bị ẩn vì
 * khoá người bán (`draft` + `hidden_by_lock_at`) giữ nguyên dù kho đổi.
 */
export const STATUS_BY_STOCK_SQL =
  "CASE WHEN stock <= 0 AND status = 'active' THEN 'sold' " +
  "WHEN stock > 0 AND status = 'sold' THEN 'active' ELSE status END";
