import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trạng thái giao & giải ngân THEO TỪNG người bán cho `order_shipments`.
 *
 * VẤN ĐỀ ĐANG CHỮA: escrow đã tách theo (order, seller), nhưng giải ngân chỉ
 * chạy ở cấp Order (đơn chuyển DELIVERED → giải ngân MỌI người bán cùng lúc).
 * Sàn C2C nhiều người bán cần: người mua xác nhận nhận hàng của TỪNG người bán
 * → giải ngân đúng người đó; ai quên bấm thì sau N ngày kể từ khi GHN báo đã
 * giao, hệ thống tự chốt (giống Shopee/Lazada).
 *
 * Thêm hai trạng thái mới ('delivered', 'received') và ba cột mốc thời gian.
 * Chiều lùi trả enum về ('created','failed') và bỏ ba cột. An toàn: dữ liệu
 * đang chạy chỉ có 'created'/'failed'.
 */
export class AddShipmentDeliveryTracking1786820000000 implements MigrationInterface {
  name = 'AddShipmentDeliveryTracking1786820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = 'order_shipments';
    if (!(await queryRunner.hasTable(table))) return;

    // MySQL: đổi enum bằng MODIFY COLUMN, giữ default cũ.
    await queryRunner.query(
      `ALTER TABLE \`${table}\` MODIFY COLUMN \`status\` ` +
        `enum('created','failed','delivered','received') NOT NULL DEFAULT 'created'`,
    );

    const addIfMissing = async (col: string, ddl: string) => {
      if (!(await queryRunner.hasColumn(table, col))) {
        await queryRunner.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
      }
    };

    await addIfMissing('delivered_at', '`delivered_at` timestamp NULL');
    await addIfMissing('received_at', '`received_at` timestamp NULL');
    await addIfMissing(
      'auto_received',
      '`auto_received` tinyint NOT NULL DEFAULT 0',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = 'order_shipments';
    if (!(await queryRunner.hasTable(table))) return;

    const dropIfExists = async (col: string) => {
      if (await queryRunner.hasColumn(table, col)) {
        await queryRunner.query(
          `ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``,
        );
      }
    };
    await dropIfExists('auto_received');
    await dropIfExists('received_at');
    await dropIfExists('delivered_at');

    // Trả enum về hai giá trị cũ. Bất kỳ dòng đang 'delivered'/'received' sẽ
    // thành '' nếu còn — nhưng chiều lùi chỉ chạy khi muốn gỡ hẳn tính năng.
    await queryRunner.query(
      `ALTER TABLE \`${table}\` MODIFY COLUMN \`status\` ` +
        `enum('created','failed') NOT NULL DEFAULT 'created'`,
    );
  }
}
