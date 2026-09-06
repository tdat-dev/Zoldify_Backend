import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đợt rà index thứ hai (31/08) — bốn list cùng hình dạng mà Epic 3b bỏ sót.
 *
 * VÌ SAO CÓ ĐỢT THỨ HAI. Epic 3b (migration 1787100000000) audit bốn list nặng
 * nhất *lúc đó* và chữa xong. Nhưng sau đó mã mới được viết thêm — ví hàng,
 * lệnh rút, danh sách chat — và không ai rà lại. Kết quả: đúng loại lỗi cũ mọc
 * lại ở bảng khác. Một lượt tối ưu không phải một lần là xong; nó cần cái chốt
 * chạy được, nên `scripts/selfcheck-indexes.ts` nay có thêm sáu mục canh.
 *
 * Cả bốn đều là "WHERE khoá + ORDER BY thời gian" — MySQL lọc được bằng index
 * 1-cột hiện có nhưng vẫn phải `Using filesort` để sắp. Index ghép cho phép nó
 * lấy sẵn thứ tự từ index, bỏ hẳn bước sắp.
 *
 * Chưa đau ngay vì database hiện tại thưa. Nó đau khi một người dùng có vài
 * trăm giao dịch ví, hoặc vài trăm hội thoại — tức là đúng lúc sàn có người
 * dùng thật.
 *
 * `.catch(()=>{})` cho idempotent, đồng bộ phong cách hai migration index trước.
 */
export class AddListOrderingIndexesRound21787300000000
  implements MigrationInterface
{
  name = 'AddListOrderingIndexesRound21787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // withdrawals: WHERE user_id ORDER BY created_at DESC
    await queryRunner
      .query(
        `CREATE INDEX idx_user_created ON withdrawals (user_id, created_at)`,
      )
      .catch(() => {});

    // payments: WHERE user_id ORDER BY created_at DESC
    await queryRunner
      .query(`CREATE INDEX idx_user_created ON payments (user_id, created_at)`)
      .catch(() => {});

    // wallet_transactions: WHERE wallet_id ORDER BY created_at DESC
    await queryRunner
      .query(
        `CREATE INDEX idx_wallet_created ON wallet_transactions (wallet_id, created_at)`,
      )
      .catch(() => {});

    // chat.getMyConversations: WHERE buyer_id = ? OR seller_id = ? ORDER BY updated_at
    //
    // Hai index chứ không một: câu truy vấn lọc theo buyer HOẶC seller (TypeORM
    // dựng thành `OR`), nên MySQL cần một index bắt đầu bằng mỗi cột. Một index
    // ghép (buyer_id, seller_id, updated_at) chỉ đỡ được vế buyer — vế seller
    // không dùng được leftmost prefix.
    //
    // Sắp theo `updated_at` chứ không `created_at`: danh sách chat xếp theo lần
    // nhắn gần nhất, không phải lần tạo hội thoại.
    await queryRunner
      .query(
        `CREATE INDEX idx_buyer_updated ON conversations (buyer_id, updated_at)`,
      )
      .catch(() => {});
    await queryRunner
      .query(
        `CREATE INDEX idx_seller_updated ON conversations (seller_id, updated_at)`,
      )
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner
      .query(`DROP INDEX idx_seller_updated ON conversations`)
      .catch(() => {});
    await queryRunner
      .query(`DROP INDEX idx_buyer_updated ON conversations`)
      .catch(() => {});
    await queryRunner
      .query(`DROP INDEX idx_wallet_created ON wallet_transactions`)
      .catch(() => {});
    await queryRunner
      .query(`DROP INDEX idx_user_created ON payments`)
      .catch(() => {});
    await queryRunner
      .query(`DROP INDEX idx_user_created ON withdrawals`)
      .catch(() => {});
  }
}
