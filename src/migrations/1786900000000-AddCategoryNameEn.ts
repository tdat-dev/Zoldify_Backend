import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thêm cột categories.name_en — tên danh mục tiếng Anh, tự dịch bằng Cloudflare
 * Workers AI lúc tạo/sửa danh mục. Null nếu chưa dịch (frontend fallback về name).
 *
 * Chịu được chạy lại: kiểm cột tồn tại trước khi thêm.
 */
export class AddCategoryNameEn1786900000000 implements MigrationInterface {
  name = 'AddCategoryNameEn1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const col = await queryRunner.query(
      `SHOW COLUMNS FROM categories LIKE 'name_en'`,
    );
    if (col?.length) return;
    await queryRunner.query(
      `ALTER TABLE categories ADD COLUMN name_en VARCHAR(150) NULL AFTER name`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const col = await queryRunner.query(
      `SHOW COLUMNS FROM categories LIKE 'name_en'`,
    );
    if (!col?.length) return;
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN name_en`);
  }
}
