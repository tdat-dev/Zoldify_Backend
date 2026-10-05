import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xoá cột `users.balance`.
 *
 * Nó từng là một trong ba nguồn sự thật về số dư, cạnh `wallets.balance` và
 * `wallet_transactions`. Giờ nguồn duy nhất là `ledger_accounts`, và không
 * còn dòng code nào ghi vào cột này nữa.
 *
 * Vì sao phải XOÁ hẳn chứ không để đó cho lành: cột còn tồn tại thì sớm muộn
 * cũng có người đọc nó — nó tên là `balance`, ai nhìn cũng tưởng dùng được.
 * Lúc đó nó trả về một con số đã đứng yên từ lâu mà không báo lỗi gì. Xoá đi
 * thì mọi chỗ dùng nhầm đều gãy ngay lúc biên dịch.
 *
 * Chiều lùi dựng lại cột với giá trị 0 cho mọi người dùng. KHÔNG khôi phục
 * được số cũ, và cũng không nên: số cũ đã sai so với sổ cái. Muốn có số đúng
 * thì đọc từ ledger_accounts.
 */
export class DropUserBalanceColumn1786600000000 implements MigrationInterface {
  name = 'DropUserBalanceColumn1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (table?.findColumnByName('balance')) {
      await queryRunner.query('ALTER TABLE `users` DROP COLUMN `balance`');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (!table?.findColumnByName('balance')) {
      await queryRunner.query(
        'ALTER TABLE `users` ADD `balance` decimal(15,2) NOT NULL DEFAULT 0.00',
      );
    }
  }
}
