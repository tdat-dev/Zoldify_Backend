import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Khoá chống trùng cho việc đặt hàng.
 *
 * VẤN ĐỀ. Người mua bấm "Đặt hàng" hai lần — mạng chập, nút không bị khoá,
 * trình duyệt tự gửi lại — thì ra hai đơn, và kho bị trừ hai lần.
 *
 * Đo được bằng `npm run check:race` R5: 20 lượt bấm đồng thời → **20 đơn**,
 * kho trừ 20 lần.
 *
 * Kho không cứu được: kho còn nhiều thì mọi lượt đều qua cửa `stock >= n`.
 * Giỏ hàng cũng không: `orders.create` xoá giỏ ở CUỐI transaction, nên bấm
 * đồng thời thì cả 20 lượt đều đọc giỏ trước khi ai kịp commit.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * DÙNG LẠI Ý TƯỞNG ĐÃ CHỨNG MINH TRONG REPO. `ledger_transactions` có
 * `idempotency_key UNIQUE`, và `LedgerService.post()` mô tả vì sao nó hiệu quả:
 *
 *   > Lá chắn thật vẫn là ràng buộc UNIQUE dưới database; SELECT chỉ để trường
 *   > hợp gửi lại thông thường không phải ném lỗi rồi bắt lại.
 *
 * Kiểm bằng `SELECT` trước rồi mới `INSERT` KHÔNG đủ — hai request song song
 * vẫn cùng thấy "chưa có" rồi cùng ghi. Đó đúng là cái bẫy mà `updateStock` đã
 * dính (BUG-06) và mà `createOrderEscrows` từng dính (`if (already > 0)`).
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * KHOÁ SINH TỪ ĐÂU. `sha256(userId + ':' + các id dòng giỏ hàng đã sắp xếp)`.
 *
 * Vì sao id dòng giỏ hàng là khoá tự nhiên tốt: `orders.create` XOÁ các dòng
 * đó khi thành công, và `carts.id` là auto-increment không tái sử dụng. Nên
 * một "giỏ" chỉ đặt được đúng một lần, còn người mua thêm lại cùng sản phẩm
 * sau đó sẽ có dòng giỏ mới, id mới, khoá mới — mua lại bình thường.
 *
 * NULL cho đơn cũ. MySQL cho phép nhiều NULL trong một khoá UNIQUE, nên
 * migration này không đụng gì tới dữ liệu đã có.
 *
 * varchar(64) vừa đúng một chuỗi sha256 dạng hex.
 */
export class AddOrderIdempotencyKey1787900000000 implements MigrationInterface {
  name = 'AddOrderIdempotencyKey1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `orders` ADD `idempotency_key` varchar(64) NULL',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` ADD UNIQUE INDEX `uq_order_idempotency` (`idempotency_key`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `orders` DROP INDEX `uq_order_idempotency`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` DROP COLUMN `idempotency_key`',
    );
  }
}
