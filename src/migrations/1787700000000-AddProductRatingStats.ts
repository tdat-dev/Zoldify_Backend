import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thêm `products.rating_avg` và `products.review_count`, rồi tính lại từ bảng
 * `reviews` đang có.
 *
 * VẤN ĐỀ ĐANG CHỮA (lỗi H-01, test E2E Android 30/09): app hiện điểm sao và số
 * đánh giá bằng số SINH NGẪU NHIÊN theo id sản phẩm, vì backend không có chỗ nào
 * cho biết hai con số đó. Tính AVG/COUNT trên `reviews` mỗi lần hiện một thẻ sản
 * phẩm thì danh sách 20 món là 20 câu tổng hợp; giữ sẵn trên `products` và cập
 * nhật lúc đánh giá thay đổi (InteractionsService.refreshProductStats) thì đọc
 * danh sách không tốn thêm câu nào.
 *
 * DECIMAL(3,2): điểm 0.00 đến 5.00, đủ một chữ số lẻ khi hiển thị. Không cho
 * NULL: sản phẩm chưa có đánh giá là 0 điểm, 0 lượt, app dựa vào review_count
 * để hiện "Chưa có đánh giá" thay vì 0 sao.
 *
 * Bước tính lại chỉ đếm đánh giá chưa xoá mềm. Chiều lùi xoá hai cột; an toàn vì
 * chúng suy lại được hoàn toàn từ `reviews`.
 */
export class AddProductRatingStats1787700000000 implements MigrationInterface {
  name = 'AddProductRatingStats1787700000000';

  private async addIfMissing(
    queryRunner: QueryRunner,
    column: string,
    definition: string,
  ) {
    const found = await queryRunner.getTable('products');
    if (found && !found.findColumnByName(column)) {
      await queryRunner.query(
        `ALTER TABLE \`products\` ADD \`${column}\` ${definition}`,
      );
    }
  }

  private async dropIfPresent(queryRunner: QueryRunner, column: string) {
    const found = await queryRunner.getTable('products');
    if (found?.findColumnByName(column)) {
      await queryRunner.query(
        `ALTER TABLE \`products\` DROP COLUMN \`${column}\``,
      );
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addIfMissing(
      queryRunner,
      'rating_avg',
      'decimal(3,2) NOT NULL DEFAULT 0',
    );
    await this.addIfMissing(
      queryRunner,
      'review_count',
      'int NOT NULL DEFAULT 0',
    );
    await queryRunner.query(`
      UPDATE \`products\` p
      LEFT JOIN (
        SELECT product_id, ROUND(AVG(rating), 2) AS a, COUNT(*) AS c
        FROM \`reviews\`
        WHERE deleted_at IS NULL
        GROUP BY product_id
      ) r ON r.product_id = p.id
      SET p.rating_avg = COALESCE(r.a, 0), p.review_count = COALESCE(r.c, 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIfPresent(queryRunner, 'review_count');
    await this.dropIfPresent(queryRunner, 'rating_avg');
  }
}
