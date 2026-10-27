import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mốc người bán (hoặc admin) xác nhận đơn.
 *
 * VÌ SAO CẦN. Job huỷ đơn quá hạn đếm 48 giờ từ `created_at` cho cả đơn
 * `confirmed`: đơn đặt thứ Sáu, người bán xác nhận sáng thứ Hai (hoặc GHN lỗi
 * lúc tạo vận đơn nên đơn nằm `confirmed` chờ tạo lại) bị huỷ và hoàn tiền
 * ngay lượt quét kế tiếp. `updated_at` không dùng được: đổi địa chỉ, ghi nhận
 * tiền, gắn mã vận đơn đều chạm nó.
 *
 * NULL cho mọi đơn hiện có: job lùi về `paid_at`, rồi `created_at`, tức đúng
 * hành vi cũ với đơn cũ.
 */
export class AddOrderConfirmedAt1788400000000 implements MigrationInterface {
  name = 'AddOrderConfirmedAt1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `orders` ADD `confirmed_at` datetime NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `orders` DROP COLUMN `confirmed_at`');
  }
}
