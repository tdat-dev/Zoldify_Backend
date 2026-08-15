import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nới cột users.avatar từ VARCHAR(255) sang TEXT.
 *
 * VÌ SAO: đăng nhập Google (Firebase) lưu `decoded.picture` — avatar URL của
 * Google — vào `users.avatar`. URL đó dài quá 255 ký tự nên MySQL trả
 * ER_DATA_TOO_LONG và cả request thành 500. Phát hiện lúc test login thật trên
 * zoldify.com sau khi đã gắn firebase-service-account cho backend.
 *
 * Chịu được chạy lại: kiểm kiểu cột trước, đã là text thì bỏ qua.
 */
export class AlterAvatarToText1786800000000 implements MigrationInterface {
  name = 'AlterAvatarToText1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const col = await queryRunner.query(
      `SHOW COLUMNS FROM users LIKE 'avatar'`,
    );
    if (col?.[0]?.Type?.toLowerCase() === 'text') return;
    await queryRunner.query(`ALTER TABLE users MODIFY avatar TEXT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users MODIFY avatar VARCHAR(255) NULL`,
    );
  }
}
