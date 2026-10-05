import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashSync } from 'bcrypt';

/**
 * Dữ liệu NỀN idempotent: 9 danh mục gốc + (tuỳ chọn) tài khoản admin.
 *
 * Vì sao là migration chứ không phải seed.ts:
 *  - Danh mục là dữ liệu THAM CHIẾU app cần để chạy (trang chủ, form đăng bán).
 *    Đặt trong migration → mọi môi trường (staging/prod) tự có sau deploy, có
 *    version, chạy đúng một lần qua service `migrate`.
 *  - `INSERT IGNORE` theo `slug`: DB đã có danh mục thì BỎ QUA, không ghi đè,
 *    không nhân đôi → an toàn cho cả DB mới lẫn DB đang chạy.
 *
 * ADMIN đặt theo BIẾN MÔI TRƯỜNG — KHÔNG hardcode mật khẩu yếu vào prod:
 *  - Chỉ tạo khi có ADMIN_EMAIL + ADMIN_PASSWORD lúc migrate; không có thì bỏ qua
 *    (prod không tự mọc admin/123456). Migration chạy MỘT lần nên đặt env TRƯỚC
 *    lần deploy đầu nếu muốn có admin nền.
 */
export class SeedBaselineData1787000000000 implements MigrationInterface {
  name = 'SeedBaselineData1787000000000';

  private readonly categories = [
    { name: 'Điện thoại', slug: 'dien-thoai' },
    { name: 'Laptop', slug: 'laptop' },
    { name: 'Tai nghe', slug: 'tai-nghe' },
    { name: 'Đồng hồ', slug: 'dong-ho' },
    { name: 'Máy tính bảng', slug: 'may-tinh-bang' },
    { name: 'Phụ kiện', slug: 'phu-kien' },
    { name: 'Quần áo', slug: 'quan-ao' },
    { name: 'Thể thao', slug: 'the-thao' },
    { name: 'Nấu ăn', slug: 'nau-an' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const c of this.categories) {
      await queryRunner.query(
        `INSERT IGNORE INTO categories (name, slug, image, is_active) VALUES (?, ?, ?, 1)`,
        [c.name, c.slug, `/media/categories/${c.slug}.webp`],
      );
    }

    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      await queryRunner.query(
        `INSERT IGNORE INTO users (full_name, email, password, role, email_verified) VALUES (?, ?, ?, 'admin', 1)`,
        ['Admin Zoldify', email, hashSync(password, 10)],
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        '[SeedBaselineData] Bỏ qua admin: chưa đặt ADMIN_EMAIL/ADMIN_PASSWORD.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Danh mục nền có thể đã có sản phẩm tham chiếu → KHÔNG xoá (tránh gãy khoá
    // ngoại và mất dữ liệu thật). Chỉ gỡ admin do chính migration này tạo.
    const email = process.env.ADMIN_EMAIL;
    if (email) {
      await queryRunner.query(
        `DELETE FROM users WHERE email = ? AND role = 'admin'`,
        [email],
      );
    }
  }
}
