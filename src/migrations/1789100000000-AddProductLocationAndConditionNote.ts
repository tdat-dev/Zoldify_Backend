import { MigrationInterface, QueryRunner } from 'typeorm';
import { toSlug } from '../common/slug';

/**
 * Thêm địa điểm và ghi chú tình trạng cho tin đăng.
 *
 * Địa điểm chép từ địa chỉ lấy hàng của shop: lọc theo tỉnh không phải nối bảng
 * shops trên 1 triệu dòng, và tin không đổi nơi khi người bán chuyển nhà.
 * Chỉ giữ tỉnh và quận, không chép địa chỉ nhà vì trường này hiện công khai.
 *
 * ĐIỀN LẠI THEO TỪNG NGƯỜI BÁN, KHÔNG MỘT CÂU UPDATE CẢ BẢNG. Prod có hơn 1 triệu
 * dòng dữ liệu thử (shop-1m-*) không cần địa điểm, và DB ở máy khác qua đường hầm.
 * Câu theo `seller_id` đi qua index nên chỉ chạm tin của shop thật.
 *
 * `updated_at = updated_at`: không có vế này thì MySQL tự đẩy ngày sửa của mọi tin
 * thật lên thời điểm chạy migration.
 *
 * Chiều lùi xoá bốn cột, an toàn vì địa điểm suy lại được từ shops. Ghi chú tình
 * trạng do người bán gõ thì mất, chấp nhận được vì đó là cột mới của bản này.
 */
export class AddProductLocationAndConditionNote1789100000000 implements MigrationInterface {
  name = 'AddProductLocationAndConditionNote1789100000000';

  private readonly cot: [string, string][] = [
    ['province_name', 'varchar(100) NULL'],
    ['province_slug', 'varchar(100) NULL'],
    ['district_name', 'varchar(100) NULL'],
    ['condition_note', 'varchar(500) NULL'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const bang = await queryRunner.getTable('products');
    for (const [ten, kieu] of this.cot) {
      if (bang && !bang.findColumnByName(ten)) {
        await queryRunner.query(
          `ALTER TABLE \`products\` ADD \`${ten}\` ${kieu}`,
        );
      }
    }

    const shops = (await queryRunner.query(
      `SELECT user_id, pickup_province_name, pickup_district_name
         FROM shops
        WHERE slug NOT LIKE 'shop-1m-%' AND pickup_province_name IS NOT NULL`,
    )) as {
      user_id: number;
      pickup_province_name: string;
      pickup_district_name: string | null;
    }[];
    for (const s of shops) {
      await queryRunner.query(
        `UPDATE products
            SET province_name = ?, province_slug = ?, district_name = ?,
                updated_at = updated_at
          WHERE seller_id = ? AND province_name IS NULL`,
        [
          s.pickup_province_name,
          toSlug(s.pickup_province_name),
          s.pickup_district_name,
          s.user_id,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const bang = await queryRunner.getTable('products');
    for (const [ten] of this.cot) {
      if (bang?.findColumnByName(ten)) {
        await queryRunner.query(
          `ALTER TABLE \`products\` DROP COLUMN \`${ten}\``,
        );
      }
    }
  }
}
