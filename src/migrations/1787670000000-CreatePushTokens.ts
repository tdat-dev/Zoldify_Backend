import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bảng `push_tokens` — token thiết bị (FCM) để đẩy thông báo push.
 *
 * Một user nhiều thiết bị nên tách bảng thay vì cột trên `users`. `token` UNIQUE
 * để cùng một thiết bị đăng ký lại chỉ cập nhật chủ sở hữu (upsert) chứ không
 * sinh bản trùng — quan trọng khi user A đăng xuất, user B đăng nhập trên cùng
 * máy: token gắn lại sang B.
 *
 * Chiều lùi xoá cả bảng. An toàn: bảng mới, không migration nào trước phụ thuộc.
 */
export class CreatePushTokens1787670000000 implements MigrationInterface {
  name = 'CreatePushTokens1787670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('push_tokens');
    if (exists) return;

    await queryRunner.query(`
      CREATE TABLE \`push_tokens\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`user_id\` int NULL,
        \`token\` varchar(512) NOT NULL,
        \`platform\` varchar(16) NOT NULL DEFAULT 'android',
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_push_token\` (\`token\`),
        INDEX \`idx_push_user\` (\`user_id\`),
        CONSTRAINT \`fk_push_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('push_tokens');
    if (exists) {
      await queryRunner.query(`DROP TABLE \`push_tokens\``);
    }
  }
}
