import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dọn hai index 1-cột thừa — đợt hai (31/08).
 *
 * Cùng loại migration 1787200000000 đã dọn cho `reviews` và `messages`, nhưng
 * hai cái này lọt vì lúc đó chưa ai quét toàn hệ:
 *
 *   products.idx_seller_id (seller_id)
 *     ⊂ idx_seller_status (seller_id, status)
 *   order_shipments.idx_shipment_order (order_id)
 *     ⊂ uq_shipment_order_seller (order_id, seller_id)
 *
 * Index 1-cột là PREFIX CON của composite, nên composite phủ mọi truy vấn nó
 * từng đỡ. Giữ lại chỉ tốn thêm một cây B+ phải cập nhật mỗi lần INSERT/UPDATE
 * và thêm dung lượng — không đổi lại được gì.
 *
 * CHỐT AN TOÀN — đã kiểm chứ không suy luận: cả hai đều đỡ một khoá ngoại
 * (`products.seller_id → users.id`, `order_shipments.order_id → orders.id`), và
 * MySQL từ chối DROP nếu đó là index duy nhất phục vụ khoá ngoại. Đã thử xoá
 * thật trên một database dựng bằng đúng 14 migration này: cả hai xoá được, số
 * khoá ngoại vẫn nguyên 34, tổng index 60 → 58. Composite bắt đầu bằng đúng cột
 * đó nên nó nhận việc đỡ khoá ngoại.
 *
 * `.catch(()=>{})` cho idempotent — chạy lại trên database đã dọn thì không sao.
 */
export class DropRedundantPrefixIndexes21787400000000
  implements MigrationInterface
{
  name = 'DropRedundantPrefixIndexes21787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .query(`DROP INDEX idx_seller_id ON products`)
      .catch(() => {});
    await queryRunner
      .query(`DROP INDEX idx_shipment_order ON order_shipments`)
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .query(`CREATE INDEX idx_seller_id ON products (seller_id)`)
      .catch(() => {});
    await queryRunner
      .query(
        `CREATE INDEX idx_shipment_order ON order_shipments (order_id)`,
      )
      .catch(() => {});
  }
}
