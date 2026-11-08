import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thẻ Độ bền của tin đăng (`condition_details`, xem `catalog/products/do-ben.ts`).
 *
 * MỘT CỘT JSON, MỘT CÂU ALTER. Bảng products có FULLTEXT nên MySQL không thêm
 * cột kiểu INSTANT được: mỗi ALTER dựng lại cả 1 triệu dòng, ~3 phút trên prod.
 * Ngày 06/11 migration 1789100000000 chạy bốn ALTER, job deploy hết hạn 10 phút
 * giữa chừng và API prod dừng 2 giờ 15 phút. Trên prod phải chạy migration này
 * BẰNG TAY trước khi deploy, đừng để job deploy chạy.
 *
 * Không điền dữ liệu ở đây: tin cũ để `NULL` là đúng nghĩa "người bán chưa
 * khai", trang chi tiết không hiện thẻ. Dữ liệu mẫu cho seed điền bằng script
 * riêng (`scripts/dien-do-ben-seed.ts`), chạy tay và có đường lùi.
 *
 * Chiều lùi xoá cột, mất thẻ người bán đã khai. Chấp nhận được vì đó là cột mới
 * của bản này.
 */
export class AddProductConditionDetails1789300000000 implements MigrationInterface {
  name = 'AddProductConditionDetails1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const bang = await queryRunner.getTable('products');
    if (bang && !bang.findColumnByName('condition_details')) {
      await queryRunner.query(
        'ALTER TABLE `products` ADD `condition_details` json NULL',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const bang = await queryRunner.getTable('products');
    if (bang?.findColumnByName('condition_details')) {
      await queryRunner.query(
        'ALTER TABLE `products` DROP COLUMN `condition_details`',
      );
    }
  }
}
