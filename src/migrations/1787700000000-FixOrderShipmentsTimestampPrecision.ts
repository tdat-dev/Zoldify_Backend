import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trả `order_shipments.created_at/updated_at` về `timestamp(6)` như mọi bảng khác.
 *
 * ĐÂY KHÔNG PHẢI CHUYỆN HÌNH THỨC.
 *
 * Migration `CreateOrderShipments` (1786810000000) tạo hai cột này là `timestamp`
 * trơn — độ phân giải MỘT GIÂY. Trong khi `orders`, `escrows` và toàn bộ phần
 * còn lại của lược đồ dùng `timestamp(6)`, tức micro-giây.
 *
 * Repo này đã trả giá một lần cho đúng chuyện đó. Epic 2 làm phân trang keyset
 * cho `orders.findAll`, và phải sửa lại bằng một commit riêng:
 *
 *     fix(epic-2): con tro keyset giu du micro-giay (timestamp(6)) tranh bo sot
 *
 * Lý do: con trỏ keyset là cặp `(created_at, id)`. Nếu `created_at` chỉ tới
 * giây thì nhiều dòng trùng mốc, và ở ranh giới trang thứ tự không ổn định —
 * có dòng bị trả hai lần, có dòng bị bỏ sót. `orders.findAll` phải đọc
 * `DATE_FORMAT(..., '%f')` để giữ đủ micro-giây chính vì vậy.
 *
 * `order_shipments` hôm nay chưa phân trang keyset nên chưa nổ. Nhưng nó là
 * bảng theo đơn — số dòng lớn ngang `orders` — và sẽ là ứng viên tiếp theo.
 * Sửa lúc bảng còn nhỏ rẻ hơn nhiều so với lúc nó đã lớn.
 *
 * Phát hiện bằng `npm run check:drift`, cổng thêm ở commit trước: TypeORM đòi
 * `CHANGE created_at ... timestamp(6)` vì entity khai `@CreateDateColumn` (mặc
 * định precision 6 trên MySQL) còn database thì không có.
 *
 * AN TOÀN. `ALTER TABLE ... MODIFY` trên cột timestamp là thao tác chép bảng,
 * nhưng `order_shipments` là bảng mới (task #26, cuối tháng 8) nên còn nhỏ.
 * Nếu production đã lớn thì chạy lúc thấp điểm — không có cách làm nóng nào
 * cho kiểu đổi này trên MySQL 8.
 *
 * Giá trị cũ KHÔNG mất: mở rộng độ chính xác chỉ thêm số 0 vào phần lẻ.
 */
export class FixOrderShipmentsTimestampPrecision1787700000000 implements MigrationInterface {
  name = 'FixOrderShipmentsTimestampPrecision1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`order_shipments\`
         MODIFY \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`order_shipments\`
         MODIFY \`updated_at\` timestamp(6) NOT NULL
           DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Thu hẹp lại LÀM MẤT phần micro-giây của mọi dòng đang có. Chấp nhận được
    // vì đây là đường lùi, và trạng thái trước migration đúng là như vậy.
    await queryRunner.query(
      `ALTER TABLE \`order_shipments\`
         MODIFY \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE \`order_shipments\`
         MODIFY \`updated_at\` timestamp NOT NULL
           DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    );
  }
}
