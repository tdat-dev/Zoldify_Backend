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
 * BACKFILL (review 27/10, mục C): đơn ĐANG `confirmed` lúc deploy được ghi mốc
 * = lúc chạy migration. Để NULL thì job lùi về `paid_at`/`created_at`, và đơn
 * COD người bán xác nhận sáng nay nhưng đặt từ ba ngày trước (chưa có mã vận
 * đơn vì GHN lỗi) bị huỷ ngay lượt quét đầu tiên sau deploy, đúng con bệnh
 * migration này sinh ra để chữa. Không biết đơn được xác nhận lúc nào, nên cho
 * mỗi đơn đang dở một cửa sổ 48 giờ mới: chậm huỷ hơn một chút, không bao giờ
 * huỷ oan. Mọi trạng thái khác để NULL, job không đọc mốc này cho chúng.
 * Đo bằng `src/ops/tasks/confirmed-at-backfill.spec.ts`.
 */
export class AddOrderConfirmedAt1788400000000 implements MigrationInterface {
  name = 'AddOrderConfirmedAt1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `orders` ADD `confirmed_at` datetime NULL',
    );
    // Mốc lấy từ đồng hồ của Node (tham số), KHÔNG dùng NOW() của MySQL: cột
    // `datetime` không mang múi giờ, và app ghi `confirmed_at` bằng Date của
    // Node qua driver. NOW() theo múi giờ phiên MySQL; đo trên máy test (MySQL
    // UTC, Node UTC+7) lệch đúng 7 giờ, tức cửa sổ "48 giờ mới" chỉ còn 41.
    await queryRunner.query(
      "UPDATE `orders` SET `confirmed_at` = ? WHERE `status` = 'confirmed' AND `confirmed_at` IS NULL",
      [new Date()],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `orders` DROP COLUMN `confirmed_at`');
  }
}
