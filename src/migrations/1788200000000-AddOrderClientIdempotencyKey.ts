import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Khoá chống trùng DO CLIENT GỬI (header `Idempotency-Key` của POST /orders).
 *
 * VÌ SAO CẦN, DÙ ĐÃ CÓ `orders.idempotency_key` (migration 1787900000000).
 * Khoá cũ băm từ id các dòng giỏ hàng: chặn được hai lượt bấm CÙNG LÚC, nhưng
 * không chặn được lượt GỬI LẠI SAU KHI lượt đầu đã commit. Lúc đó giỏ đã bị
 * xoá, lượt gửi lại đọc giỏ rỗng và nhận "Giỏ hàng trống": đơn đã có mà app
 * báo lỗi (mạng di động rớt đúng lúc nhận phản hồi).
 *
 * VÌ SAO CỘT RIÊNG, KHÔNG DÙNG LẠI CỘT CŨ VỚI TIỀN TỐ. Một cột chỉ giữ được
 * một khoá. Đổi nó sang khoá của client thì mất khoá giỏ hàng, và client nào
 * lỡ sinh khoá mới cho mỗi lần bấm (bấm đúp với hai khoá khác nhau) là lại ra
 * hai đơn, đúng lỗi `check:race` R5 đã đo (20 lượt → 20 đơn). Hai cột, hai
 * khoá UNIQUE: mỗi khoá chặn một kiểu trùng.
 *
 * UNIQUE THEO (user_id, khoá) chứ không riêng khoá: khoá do client tự sinh,
 * hai người dùng trùng chuỗi thì không được nhận đơn của nhau, cũng không
 * được chặn nhau.
 *
 * varchar(100): đúng trần mà API nhận. NULL cho mọi đơn không gửi header;
 * MySQL cho nhiều NULL trong khoá UNIQUE nên không đụng dữ liệu cũ.
 */
export class AddOrderClientIdempotencyKey1788200000000 implements MigrationInterface {
  name = 'AddOrderClientIdempotencyKey1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `orders` ADD `client_idempotency_key` varchar(100) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` ADD UNIQUE INDEX `uq_order_user_client_key` (`user_id`, `client_idempotency_key`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `orders` DROP INDEX `uq_order_user_client_key`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` DROP COLUMN `client_idempotency_key`',
    );
  }
}
