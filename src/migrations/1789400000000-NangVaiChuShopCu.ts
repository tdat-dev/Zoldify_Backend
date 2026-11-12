import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nâng `buyer` đã có shop lên `seller` (issue #41).
 *
 * Trước bản sửa, POST /shop không đổi vai trò, nên mọi người mở shop đều kẹt
 * ở `buyer` và app giấu khu Người bán của họ (đo staging 12/11: id 18, 21).
 * `ShopService.create` nay tự nâng cho người mở shop mới; migration này chữa
 * những người mở shop TRƯỚC đó.
 *
 * Chỉ một câu UPDATE trên bảng users (không ALTER, không đụng products có
 * FULLTEXT), nên an toàn cho job deploy. Điều kiện `role = 'buyer'` để admin và
 * moderator có shop không bị hạ quyền.
 *
 * Chiều lùi không làm gì: sau khi chạy thì không còn biết ai là `seller` nhờ
 * migration và ai được admin đổi tay, hạ ngược sẽ hạ nhầm người thứ hai.
 */
export class NangVaiChuShopCu1789400000000 implements MigrationInterface {
  name = 'NangVaiChuShopCu1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE `users` u INNER JOIN `shops` s ON s.user_id = u.id SET u.role = 'seller' WHERE u.role = 'buyer'",
    );
  }

  public async down(): Promise<void> {
    // Cố ý không hạ lại: xem chú thích đầu file.
  }
}
