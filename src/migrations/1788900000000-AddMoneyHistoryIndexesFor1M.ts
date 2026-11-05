import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index cho hai danh sách tiền, đo trên prod 1 triệu dòng ngày 05/11.
 *
 * `GET /wallets/transactions` sắp theo `id` trong khi index chỉ có (account_id,
 * created_at), nên MySQL đi lùi cả khoá chính của ledger_entries và lọc dần: p95
 * 7,1 giây ở 50 kết nối. Người càng ít giao dịch càng phải quét lâu mới đủ một
 * trang, nên đây không phải chuyện của riêng người bán lớn.
 *
 * `GET /escrows/seller/:id` filesort 9.945 dòng rồi nối đơn và người mua: 100% trả
 * 500 vì chạm trần 5 giây, kể cả chỉ một người gọi.
 *
 * Giữ `idx_seller`: nó là chỗ dựa của khoá ngoại, xoá thì `synchronize` của các
 * spec chạy trên DB cũ báo không xoá được và cả bộ test đỏ. Tốn thêm vài MB đổi
 * lấy không phải dọn DB thử. `idx_created` cho danh sách admin không lọc trạng thái.
 *
 * INPLACE, LOCK=NONE: thêm index không khoá ghi trên bảng 4,3 triệu dòng.
 */
export class AddMoneyHistoryIndexesFor1M1788900000000 implements MigrationInterface {
  name = 'AddMoneyHistoryIndexesFor1M1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`ledger_entries\`
        ADD INDEX \`idx_ledger_entry_account_id\` (\`account_id\`, \`id\`),
        ALGORITHM=INPLACE, LOCK=NONE
    `);
    await queryRunner.query(`
      ALTER TABLE \`escrows\`
        ADD INDEX \`idx_seller_created\` (\`seller_id\`, \`created_at\`),
        ADD INDEX \`idx_created\` (\`created_at\`),
        ALGORITHM=INPLACE, LOCK=NONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`escrows\`
        DROP INDEX \`idx_created\`,
        DROP INDEX \`idx_seller_created\`
    `);
    await queryRunner.query(`
      ALTER TABLE \`ledger_entries\` DROP INDEX \`idx_ledger_entry_account_id\`
    `);
  }
}
