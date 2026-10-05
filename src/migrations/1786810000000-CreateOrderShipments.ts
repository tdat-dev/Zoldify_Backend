import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bảng `order_shipments` — một lô hàng của một người bán trong một đơn.
 *
 * VẤN ĐỀ ĐANG CHỮA: một đơn có thể gồm hàng của nhiều người bán (tiền đã tách
 * theo người bán ở `escrows`), nhưng vận đơn GHN gộp làm một ở cấp Order
 * (`order.tracking_code` đơn lẻ) → hàng nhiều người bán bị coi như gửi cùng một
 * chỗ. Bảng này tách vận đơn theo (order, seller), mirror đúng cách `escrows`
 * đã tách tiền.
 *
 * Ràng buộc UNIQUE(order_id, seller_id): mỗi người bán chỉ một lô trong một đơn
 * — cũng là chốt chặn tạo trùng vận đơn khi xác nhận lại.
 *
 * Chiều lùi xoá cả bảng. An toàn: bảng mới, không migration nào trước phụ thuộc.
 */
export class CreateOrderShipments1786810000000 implements MigrationInterface {
  name = 'CreateOrderShipments1786810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('order_shipments');
    if (exists) return;

    await queryRunner.query(`
      CREATE TABLE \`order_shipments\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`order_id\` int NULL,
        \`seller_id\` int NULL,
        \`tracking_code\` varchar(100) NULL,
        \`cod_amount\` decimal(15,2) NOT NULL DEFAULT '0.00',
        \`status\` enum('created','failed') NOT NULL DEFAULT 'created',
        \`error\` text NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_shipment_order_seller\` (\`order_id\`, \`seller_id\`),
        INDEX \`idx_shipment_order\` (\`order_id\`),
        INDEX \`idx_shipment_seller\` (\`seller_id\`),
        CONSTRAINT \`fk_shipment_order\` FOREIGN KEY (\`order_id\`)
          REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_shipment_seller\` FOREIGN KEY (\`seller_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('order_shipments');
    if (exists) {
      await queryRunner.query(`DROP TABLE \`order_shipments\``);
    }
  }
}
