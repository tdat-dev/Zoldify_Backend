import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sổ cái kép cho toàn bộ tiền của Zoldify.
 *
 * Ba bảng thay cho cách cũ là cộng thẳng vào users.balance:
 *  - ledger_accounts     mỗi người nhiều tài khoản theo trạng thái tiền
 *  - ledger_transactions một sự kiện tiền, có khoá chống trùng UNIQUE
 *  - ledger_entries      từng dòng bút toán, CHỈ THÊM không sửa
 *
 * Tiền lưu BIGINT đơn vị ĐỒNG. Tiền Việt không có xu, và DECIMAL đi qua
 * Number() của JS thì mất chính xác âm thầm với số lớn.
 */
export class CreateLedgerTables1786100000000 implements MigrationInterface {
  name = 'CreateLedgerTables1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ledger_accounts (
        id          BIGINT NOT NULL AUTO_INCREMENT,
        owner_type  ENUM('user','platform','external') NOT NULL,
        owner_id    BIGINT NULL,
        purpose     ENUM(
                      'available','escrow_hold','withdrawal_pending',
                      'revenue','gateway_clearing','bank_external'
                    ) NOT NULL,
        balance     BIGINT NOT NULL DEFAULT 0,
        version     INT NOT NULL DEFAULT 1,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ledger_account (owner_type, owner_id, purpose)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ledger_transactions (
        id              BIGINT NOT NULL AUTO_INCREMENT,
        type            ENUM(
                          'topup','order_hold','escrow_release','escrow_refund',
                          'withdrawal_approve','withdrawal_complete','adjustment'
                        ) NOT NULL,
        idempotency_key VARCHAR(191) NOT NULL,
        reference_type  VARCHAR(50) NULL,
        reference_id    BIGINT NULL,
        metadata        JSON NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ledger_idempotency (idempotency_key),
        KEY idx_ledger_tx_ref (reference_type, reference_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // RESTRICT chứ không CASCADE: sổ cái là bằng chứng, xoá đi thì không
    // còn truy được tiền đã đi đâu.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id             BIGINT NOT NULL AUTO_INCREMENT,
        transaction_id BIGINT NOT NULL,
        account_id     BIGINT NOT NULL,
        amount         BIGINT NOT NULL,
        balance_after  BIGINT NOT NULL,
        created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_ledger_entry_account_time (account_id, created_at),
        KEY idx_ledger_entry_tx (transaction_id),
        CONSTRAINT fk_ledger_entry_tx FOREIGN KEY (transaction_id)
          REFERENCES ledger_transactions (id) ON DELETE RESTRICT,
        CONSTRAINT fk_ledger_entry_account FOREIGN KEY (account_id)
          REFERENCES ledger_accounts (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Ngược thứ tự tạo vì có khoá ngoại
    await queryRunner.query(`DROP TABLE IF EXISTS ledger_entries`);
    await queryRunner.query(`DROP TABLE IF EXISTS ledger_transactions`);
    await queryRunner.query(`DROP TABLE IF EXISTS ledger_accounts`);
  }
}
