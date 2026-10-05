import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thêm địa chỉ LẤY HÀNG (pickup) của người bán vào bảng `shops`.
 *
 * VẤN ĐỀ ĐANG CHỮA: Zoldify là sàn C2C — mỗi người bán tự gửi hàng từ nhà mình
 * — nhưng toàn hệ thống chỉ có MỘT điểm gửi cố định trong biến môi trường
 * (GHN_SHOP_ID / GHN_FROM_DISTRICT_ID). Hệ quả đo được: mọi vận đơn GHN đều
 * xuất từ cùng một địa chỉ của sàn, kể cả khi hàng thực tế nằm ở nhà người bán
 * khác tỉnh → phí và điểm lấy hàng đều sai.
 *
 * Lưu cả ID lẫn TÊN vì GHN dùng hai kiểu ở hai chỗ:
 *   · tính phí -> district_id (số) + ward_code
 *   · tạo đơn  -> from_district_name / from_ward_name / from_province_name (chữ)
 *
 * Tất cả cột đều nullable: shop cũ chưa khai vẫn hợp lệ, và khi thiếu pickup thì
 * GhnService rơi về shop GHN mặc định của sàn (xem GhnService). Việc BẮT BUỘC
 * khai đủ trước khi bán được kiểm ở tầng ứng dụng, không phải ở ràng buộc cột.
 *
 * Chiều lùi xoá cả tám cột — không cột nào chứa dữ liệu suy lại được, trước
 * migration này chúng vốn chưa tồn tại.
 */
export class AddShopPickupAddress1786800000000 implements MigrationInterface {
  name = 'AddShopPickupAddress1786800000000';

  private async addIfMissing(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    definition: string,
  ) {
    const found = await queryRunner.getTable(table);
    if (found && !found.findColumnByName(column)) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` ADD \`${column}\` ${definition}`,
      );
    }
  }

  private async dropIfPresent(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ) {
    const found = await queryRunner.getTable(table);
    if (found?.findColumnByName(column)) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``,
      );
    }
  }

  private readonly columns: Array<[string, string]> = [
    ['pickup_name', 'varchar(100) NULL'],
    ['pickup_phone', 'varchar(20) NULL'],
    ['pickup_address', 'varchar(255) NULL'],
    ['pickup_province_name', 'varchar(100) NULL'],
    ['pickup_district_id', 'int NULL'],
    ['pickup_district_name', 'varchar(100) NULL'],
    ['pickup_ward_code', 'varchar(20) NULL'],
    ['pickup_ward_name', 'varchar(100) NULL'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [column, definition] of this.columns) {
      await this.addIfMissing(queryRunner, 'shops', column, definition);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [column] of this.columns) {
      await this.dropIfPresent(queryRunner, 'shops', column);
    }
  }
}
