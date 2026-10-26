import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đánh dấu tin bị ẩn VÌ khoá tài khoản người bán.
 *
 * VÌ SAO CẦN. Khoá người bán chuyển hàng đang bán của họ sang `draft`. Bản
 * đầu (rà soát 26/10) mở khoá bằng cách chuyển MỌI tin `draft` của người đó
 * về `active`, dựa vào giả định "không đường API nào tạo ra `draft`". Giả
 * định đó không đứng được: seed, sửa tay trong DB, và luồng soạn nháp sau
 * này đều tạo ra `draft` thật, và mở khoá sẽ đăng luôn bản nháp người bán
 * chưa muốn đăng (review 26/10 mục 4).
 *
 * Cột này ghi lúc tin bị ẩn vì khoá: mở khoá chỉ bày lại đúng những tin có
 * dấu, rồi xoá dấu. Khoá lại lần nữa chỉ chạm tin còn `active`, nên tin đã
 * mang dấu từ lần trước giữ nguyên dấu (khoá lặp vô hại).
 *
 * NULL cho mọi tin hiện có: không tin nào đang bị ẩn theo cách mới.
 */
export class AddProductHiddenByLockAt1788300000000 implements MigrationInterface {
  name = 'AddProductHiddenByLockAt1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `products` ADD `hidden_by_lock_at` datetime NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `products` DROP COLUMN `hidden_by_lock_at`',
    );
  }
}
