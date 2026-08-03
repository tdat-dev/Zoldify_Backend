import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1700000000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Products
    await queryRunner.query(`CREATE INDEX idx_category_id ON products (category_id)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_seller_id ON products (seller_id)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_status ON products (status)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_created_at ON products (created_at)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_price ON products (price)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_seller_status ON products (seller_id, status)`).catch(() => {});

    // Orders
    await queryRunner.query(`CREATE INDEX idx_created_at ON orders (created_at)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_user_status ON orders (user_id, status)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_user_created ON orders (user_id, created_at)`).catch(() => {});

    // Notifications
    await queryRunner.query(`CREATE INDEX idx_user_read ON notifications (user_id, is_read)`).catch(() => {});
    await queryRunner.query(`CREATE INDEX idx_created_at ON notifications (created_at)`).catch(() => {});

    // Order Items
    await queryRunner.query(`CREATE INDEX idx_product_id ON order_items (product_id)`).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Products
    await queryRunner.query(`DROP INDEX idx_category_id ON products`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_seller_id ON products`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_status ON products`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_created_at ON products`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_price ON products`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_seller_status ON products`).catch(() => {});

    // Orders
    await queryRunner.query(`DROP INDEX idx_created_at ON orders`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_user_status ON orders`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_user_created ON orders`).catch(() => {});

    // Notifications
    await queryRunner.query(`DROP INDEX idx_user_read ON notifications`).catch(() => {});
    await queryRunner.query(`DROP INDEX idx_created_at ON notifications`).catch(() => {});

    // Order Items
    await queryRunner.query(`DROP INDEX idx_product_id ON order_items`).catch(() => {});
  }
}