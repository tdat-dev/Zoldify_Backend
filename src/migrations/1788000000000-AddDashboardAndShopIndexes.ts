import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hai index cho hai câu quét toàn bảng còn lại trong `sql-audit.md`.
 *
 * ĐO TRƯỚC, KHÔNG ĐOÁN. Cả hai đều dựng index tạm rồi `EXPLAIN` trên
 * `zoldify_sqlaudit` (1.000 đơn, 1.000 sản phẩm) trước khi viết file này.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 1. orders (is_paid, status, final_amount)
 *
 * Hai bảng điều khiển cùng cộng doanh thu và cùng quét toàn bảng:
 *
 *   admin.service.ts:137   SUM(final_amount) WHERE status = 'delivered'
 *   orders.service.ts:80   SUM(final_amount) WHERE status != 'cancelled' AND is_paid = 1
 *
 * Đo được:
 *
 *   trước:  type=ALL  key=NULL            rows=1000
 *   sau:    type=ref  key=idx_paid_status_amount  rows=681/813  Using index
 *
 *   `Using index` = đọc xong ngay trong index, không phải lần về bảng lấy dòng.
 *
 * VÌ SAO MỘT INDEX CHO CẢ HAI, VÀ VÌ SAO PHẢI SỬA admin.service KÈM THEO.
 *
 * `(is_paid, status, ...)` không phục vụ được `WHERE status = 'delivered'`
 * đứng một mình — cột trái nhất là `is_paid`. Nên hoặc thêm index thứ hai,
 * hoặc để câu của admin cũng lọc `is_paid`.
 *
 * Chọn cách thứ hai, vì nó đúng hơn chứ không chỉ nhanh hơn: một đơn đã giao
 * mà chưa thu được tiền (COD chưa đối soát) thì không phải doanh thu đã nhận.
 * `orders.getStats` đã sửa theo hướng đó ở BUG-21; để `admin.getStats` tính
 * kiểu khác là hai bảng điều khiển nói hai con số "doanh thu" khác nhau.
 *
 * Đo trên dữ liệu soi: con số KHÔNG đổi (242.945.955 cả hai cách) vì mọi đơn
 * `delivered` ở đó đều đã trả tiền. Tức đây là chốt an toàn cho tương lai chứ
 * không phải một lần sửa số liệu.
 *
 * Đổi lại: một index nữa trên bảng `orders` đang nóng. Chấp nhận được vì nó
 * thay thế nhu cầu có HAI index, và vì hai câu này chạy mỗi lần ai đó mở bảng
 * điều khiển — trong khi quét toàn bảng thì đắt dần theo từng đơn mới.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 2. products (seller_id, status, created_at) — THAY idx_seller_status
 *
 * `sql-audit.md` xếp `shop.service.ts:110` mức CAO. Phần "bảng dẫn xuất +
 * DISTINCT" là do `findAndCount` kèm relations, nhưng `filesort` đến từ chỗ
 * khác: `idx_seller_status` phủ được WHERE mà không phủ `ORDER BY created_at`.
 *
 * Đây đúng mẫu mà `npm run check:index` sinh ra để bắt — chỉ là gian hàng của
 * người bán chưa bao giờ nằm trong danh sách của nó. Đã thêm vào cùng lúc.
 *
 * KHÔNG PHẢI THÊM MỘT INDEX, MÀ LÀ MỞ RỘNG MỘT CÁI CÓ SẴN. Index mới phủ
 * `(seller_id)` và `(seller_id, status)` theo quy tắc leftmost-prefix, nên
 * `idx_seller_status` thành thừa và bị xoá. Số index trên `products` không đổi.
 */
export class AddDashboardAndShopIndexes1788000000000 implements MigrationInterface {
  name = 'AddDashboardAndShopIndexes1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX `idx_paid_status_amount` ON `orders` (`is_paid`, `status`, `final_amount`)',
    );

    // TẠO TRƯỚC, XOÁ SAU — THỨ TỰ NÀY BẮT BUỘC.
    //
    // `products.seller_id` có khoá ngoại tới `users`, và MySQL đòi phải luôn
    // tồn tại một index bắt đầu bằng `seller_id` để đỡ nó. `idx_seller_status`
    // đang làm việc đó. Xoá nó trước khi có cái thay thế thì MySQL từ chối:
    //
    //     Cannot drop index 'idx_seller_status': needed in a foreign key constraint
    //
    // Đã gặp thật: `synchronize` của TypeORM (chỉ dùng lúc chạy test) tính ra
    // thứ tự ngược lại và làm đỏ 71 bài kiểm. Migration thì tự quyết thứ tự
    // được, nên ở đây tạo cái mới — nó cũng bắt đầu bằng `seller_id` nên đỡ
    // được khoá ngoại — rồi mới xoá cái cũ.
    await queryRunner.query(
      'CREATE INDEX `idx_seller_status_created` ON `products` (`seller_id`, `status`, `created_at`)',
    );
    // Thừa theo leftmost-prefix của index vừa tạo. Giữ lại là trả tiền ghi cho
    // một thứ không ai đọc — đúng lý do mà DropRedundantPrefixIndexes đã dọn
    // `idx_seller_id` trước đây.
    await queryRunner.query('DROP INDEX `idx_seller_status` ON `products`');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX `idx_seller_status` ON `products` (`seller_id`, `status`)',
    );
    await queryRunner.query(
      'DROP INDEX `idx_seller_status_created` ON `products`',
    );
    await queryRunner.query('DROP INDEX `idx_paid_status_amount` ON `orders`');
  }
}
