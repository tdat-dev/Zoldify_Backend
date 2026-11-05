import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index phủ cho câu đếm có trần của danh sách sản phẩm lọc theo giá.
 *
 * Khối "Dưới 100k" trên trang chủ gọi `GET /products?price_max=...`. Đo trên prod
 * 1 triệu dòng ngày 05/11: lấy 4 món 10 ms, nhưng đếm tới 10.001 dòng mất 2.723 ms.
 * `idx_status_price` không có `deleted_at`, nên MySQL về bảng đọc từng dòng trong
 * 10.001 dòng, rải khắp bảng 1,5 GB với buffer pool 256 MB. Cache hết hạn là lặp
 * lại, và lúc máy bận đã chạm trần 5 giây trả 500.
 *
 * `deleted_at` đứng trước `price`: nó là phép so bằng (IS NULL), nên khoảng giá vẫn
 * dùng được phần cuối index. Đảo lại thì phạm vi giá chặn mất cột sau.
 *
 * Giữ `idx_status_price`: thay thì phải đổi mọi câu sắp theo giá và đo lại, trong
 * khi index này chỉ thêm vài chục MB.
 *
 * INPLACE, LOCK=NONE: không khoá ghi trên bảng 1 triệu dòng.
 */
export class AddProductPriceCountIndexFor1M1789000000000 implements MigrationInterface {
  name = 'AddProductPriceCountIndexFor1M1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`products\`
        ADD INDEX \`idx_status_deleted_price\` (\`status\`, \`deleted_at\`, \`price\`),
        ALGORITHM=INPLACE, LOCK=NONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`products\` DROP INDEX \`idx_status_deleted_price\`
    `);
  }
}
