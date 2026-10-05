import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 3 (dọn nợ) — Bỏ 2 index 1-cột THỪA sau khi đã có index ghép.
 *
 * AddListOrderingIndexes1787100000000 thêm các index ghép (khoá, created_at) rồi
 * GIỮ TẠM index 1-cột cũ để không rủi ro. Nay audit (scripts/selfcheck-indexes.ts,
 * phần "index 1-cột thừa") xác nhận drop AN TOÀN:
 *   - reviews.idx_product_id (product_id)          → prefix con của idx_product_created
 *     (product_id, created_at); FK product_id→products vẫn được composite đỡ.
 *   - messages.idx_conversation_id (conversation_id)→ prefix con của idx_conversation_created
 *     (conversation_id, created_at); FK conversation_id→conversations vẫn được đỡ.
 *
 * Index thừa chỉ tốn thêm ghi (mỗi INSERT/UPDATE phải cập nhật) + dung lượng, không
 * phục vụ truy vấn nào mà composite chưa phủ. Decorator @Index tương ứng ở entity đã
 * gỡ (review.entity.ts, message.entity.ts) để nguồn sự thật khớp DB.
 *
 * `.catch(()=>{})` cho idempotent, đồng bộ phong cách AddListOrderingIndexes. Nếu drop
 * bị chặn (vd MySQL coi index đang đỡ FK) thì selfcheck-indexes vẫn báo ĐỎ — lưới an toàn.
 */
export class DropRedundantPrefixIndexes1787200000000
  implements MigrationInterface
{
  name = 'DropRedundantPrefixIndexes1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .query(`DROP INDEX idx_product_id ON reviews`)
      .catch(() => {});
    await queryRunner
      .query(`DROP INDEX idx_conversation_id ON messages`)
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .query(`CREATE INDEX idx_product_id ON reviews (product_id)`)
      .catch(() => {});
    await queryRunner
      .query(`CREATE INDEX idx_conversation_id ON messages (conversation_id)`)
      .catch(() => {});
  }
}
