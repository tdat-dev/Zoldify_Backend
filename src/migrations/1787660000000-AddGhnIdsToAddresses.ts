import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thêm `addresses.ghn_province_id`, `ghn_district_id`, `ghn_ward_code`.
 *
 * VẤN ĐỀ ĐANG CHỮA: sổ địa chỉ chỉ lưu TÊN tỉnh/quận/phường (đủ để hiển thị),
 * nhưng GHN tính phí ship cần MÃ SỐ (district_id, ward_code). Không có mã thì
 * địa chỉ đã lưu không dùng lại được ở màn thanh toán — người mua phải chọn lại
 * tỉnh/quận/phường mỗi lần. Ba cột này lưu mã ngay lúc thêm địa chỉ (form GHN
 * vốn đã có sẵn mã) để checkout chọn địa chỉ là ra phí luôn.
 *
 * Nullable: địa chỉ CŨ nhập trước migration này không có mã — để null, checkout
 * sẽ bắt chọn lại khi thiếu. Không phỏng đoán mã cho dữ liệu cũ (map theo tên
 * dễ sai). ward_code là CHUỖI theo GHN (vd "1A0807"), province/district là số.
 *
 * Chiều lùi xoá cả ba cột; an toàn vì chỉ là dữ liệu suy lại được từ form.
 */
export class AddGhnIdsToAddresses1787660000000 implements MigrationInterface {
  name = 'AddGhnIdsToAddresses1787660000000';

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

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addIfMissing(
      queryRunner,
      'addresses',
      'ghn_province_id',
      'int NULL',
    );
    await this.addIfMissing(
      queryRunner,
      'addresses',
      'ghn_district_id',
      'int NULL',
    );
    await this.addIfMissing(
      queryRunner,
      'addresses',
      'ghn_ward_code',
      'varchar(20) NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIfPresent(queryRunner, 'addresses', 'ghn_ward_code');
    await this.dropIfPresent(queryRunner, 'addresses', 'ghn_district_id');
    await this.dropIfPresent(queryRunner, 'addresses', 'ghn_province_id');
  }
}
