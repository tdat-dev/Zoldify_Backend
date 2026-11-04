import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bảng `user_sessions`: một lần đăng nhập một dòng, để đăng xuất ở một máy
 * không đá các máy khác (thẻ Trello P2, xem user-session.entity.ts).
 *
 * Chỉ thêm bảng mới, không đụng bảng cũ: mã bản trước chạy trên lược đồ này
 * không biết gì khác, nên chạy migration trước khi thay ảnh api là an toàn.
 * `users.refresh_token` giữ nguyên, token phát trước bản này vẫn đi đường cũ.
 *
 * Chiều lùi xoá cả bảng. Không migration nào phụ thuộc nó, nhưng mọi token mang
 * `sid` còn hạn sẽ mất phiên nếu sau đó lại chạy mã có kiểm `sid` trên bảng
 * rỗng. Lùi mã thôi thì không cần lùi bảng.
 */
export class CreateUserSessions1788800000000 implements MigrationInterface {
  name = 'CreateUserSessions1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('user_sessions');
    if (exists) return;

    await queryRunner.query(`
      CREATE TABLE \`user_sessions\` (
        \`id\` char(36) NOT NULL,
        \`user_id\` int NOT NULL,
        \`refresh_hash\` char(64) NOT NULL,
        \`revoked_at\` timestamp NULL,
        \`expires_at\` timestamp NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_phien_user_het_han\` (\`user_id\`, \`expires_at\`),
        CONSTRAINT \`fk_phien_user\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.hasTable('user_sessions');
    if (exists) {
      await queryRunner.query(`DROP TABLE \`user_sessions\``);
    }
  }
}
