import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index cho truy vấn tin thật của trang đích: chỉ tin thật có `province_slug`, nên
 * index đưa thẳng tới vài nghìn dòng thay vì quét 1 triệu dòng thử (đo 1,8 giây).
 *
 * `ALGORITHM=INPLACE, LOCK=NONE`: bảng vẫn đọc ghi được trong lúc dựng. Nếu MySQL
 * không làm được kiểu đó thì câu lệnh báo lỗi ngay chứ không âm thầm khoá bảng.
 * Bảng này có FULLTEXT nên ALTER thêm cột từng mất 3 phút mỗi lần (xem migration
 * 1789100000000). Prod nên chạy câu này bằng tay trước khi deploy; kiểm tra có sẵn
 * ở dưới làm lần deploy bỏ qua nó.
 */
export class AddProductProvinceIndex1789200000000 implements MigrationInterface {
  name = 'AddProductProvinceIndex1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const bang = await queryRunner.getTable('products');
    if (bang?.indices.some((i) => i.name === 'idx_province_status')) return;
    await queryRunner.query(
      'ALTER TABLE `products` ADD INDEX `idx_province_status` (`province_slug`, `status`), ALGORITHM=INPLACE, LOCK=NONE',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `products` DROP INDEX `idx_province_status`',
    );
  }
}
