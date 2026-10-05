import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 3 (phần 2) — Index ghép cho các danh sách "WHERE khoá + ORDER BY created_at".
 *
 * Audit (scripts/selfcheck-indexes.ts) phát hiện 4 list nặng còn thiếu index ghép,
 * nên MySQL phải `Using filesort` (và `reviews` toàn bảng thì `type=ALL` quét 497k
 * dòng). Với seed hiện tại mỗi khoá chỉ ~1 dòng nên chưa đau, nhưng app thật (1 user
 * hàng trăm thông báo, 1 sản phẩm hot hàng nghìn review, 1 hội thoại hàng nghìn tin)
 * sẽ filesort nặng.
 *
 * Index ghép (khoá_lọc, created_at) cho phép MySQL vừa lọc vừa lấy sẵn thứ tự
 * created_at DESC từ index → BỎ filesort. Index cũ 1-cột (idx_product_id,
 * idx_conversation_id...) trở thành prefix con của index mới; giữ lại để không rủi
 * ro luồng khác — có thể dọn ở PR sau (xem báo cáo).
 *
 * `.catch(()=>{})` cho idempotent, đồng bộ phong cách AddPerformanceIndexes.
 */
export class AddListOrderingIndexes1787100000000 implements MigrationInterface {
  name = 'AddListOrderingIndexes1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // notifications.findAll: WHERE user_id ORDER BY created_at DESC
    await queryRunner
      .query(`CREATE INDEX idx_user_created ON notifications (user_id, created_at)`)
      .catch(() => {});

    // interactions.findByProduct (reviews): WHERE product_id ORDER BY created_at DESC
    await queryRunner
      .query(`CREATE INDEX idx_product_created ON reviews (product_id, created_at)`)
      .catch(() => {});

    // interactions.findAll (reviews, admin): ORDER BY created_at DESC toàn bảng
    await queryRunner
      .query(`CREATE INDEX idx_created_at ON reviews (created_at)`)
      .catch(() => {});

    // chat.getMessages (messages): WHERE conversation_id ORDER BY created_at DESC
    await queryRunner
      .query(`CREATE INDEX idx_conversation_created ON messages (conversation_id, created_at)`)
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_user_created ON notifications`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_product_created ON reviews`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_created_at ON reviews`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_conversation_created ON messages`).catch(() => {});
  }
}
