import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Bảng nhật ký hành động quản trị (task #34).
 *
 * `IF NOT EXISTS` qua `hasTable`: một số máy đã dựng lược đồ bằng
 * `synchronize: true` trước khi có migration này, và chạy `CREATE TABLE` trên
 * bảng đã có sẽ làm migration dừng giữa chừng — đúng lỗi mà `InitialSchema`
 * đã phải xử một lần rồi (xem DEPLOY.md, mục "Database dựng từ số không").
 */
export class AddAdminActionLogs1788100000000 implements MigrationInterface {
  name = 'AddAdminActionLogs1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('admin_action_logs')) return;

    await queryRunner.createTable(
      new Table({
        name: 'admin_action_logs',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'admin_id', type: 'int' },
          { name: 'method', type: 'varchar', length: '10' },
          // 512 chứ không 255: query string của /admin/users?q=...&role=...
          // dài bất ngờ, và MySQL ở chế độ mặc định CẮT CỤT trong im lặng —
          // nhật ký mất phần đuôi mà không ai được báo.
          { name: 'path', type: 'varchar', length: '512' },
          { name: 'action', type: 'varchar', length: '100' },
          {
            name: 'target_type',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'target_id',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'status_code', type: 'int', isNullable: true },
          // 45 = độ dài IPv6 dạng ánh xạ IPv4 (::ffff:255.255.255.255)
          { name: 'ip', type: 'varchar', length: '45', isNullable: true },
          {
            name: 'user_agent',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'payload', type: 'json', isNullable: true },
          {
            // `timestamp(6)` chứ không `timestamp`, và đây là lỗi repo đã dính
            // một lần rồi: `@CreateDateColumn({ type: 'timestamp' })` của
            // TypeORM mong MICRO-GIÂY, nên một cột `timestamp` trơn làm
            // `check:drift` đỏ 5 dòng — TypeORM muốn xoá hai index, đổi kiểu
            // cột, rồi dựng lại index.
            //
            // Lệch kiểu này không làm test đỏ và không làm app đỏ. Nó chỉ nổ
            // vào lần kế ai đó chạy `migration:generate`: TypeORM sinh ra một
            // migration "sửa" lược đồ theo entity và đụng vào bảng đang phục vụ
            // production. Xem `1787700000000-FixOrderShipmentsTimestampPrecision`
            // — cùng một cái bẫy, trên `order_shipments`.
            name: 'created_at',
            type: 'timestamp(6)',
            default: 'CURRENT_TIMESTAMP(6)',
          },
        ],
      }),
      true,
    );

    // KHÔNG có khoá ngoại tới `users`.
    //
    // Vết phải sống lâu hơn tài khoản gây ra nó. Một khoá ngoại ON DELETE
    // CASCADE sẽ xoá sạch nhật ký của đúng người vừa bị xoá — tức mất bằng
    // chứng đúng lúc cần nhất. Còn RESTRICT thì chặn cả thao tác xoá hợp lệ.
    // Nên giữ `admin_id` trần và chấp nhận nó có thể trỏ tới một id không còn.

    // Hai câu hỏi hay gặp nhất khi có sự cố, mỗi câu một index ghép:
    //   "ai đã đụng vào bản ghi này"  → (target_type, target_id, created_at)
    //   "admin X đã làm những gì"     → (admin_id, created_at)
    await queryRunner.createIndex(
      'admin_action_logs',
      new TableIndex({
        name: 'idx_target_created',
        columnNames: ['target_type', 'target_id', 'created_at'],
      }),
    );
    await queryRunner.createIndex(
      'admin_action_logs',
      new TableIndex({
        name: 'idx_admin_created',
        columnNames: ['admin_id', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Chỉ xoá khi bảng còn trống.
    //
    // Cùng lý do với migration xoá `payos_webhook_logs`: một lệnh `down` âm
    // thầm vứt bỏ bằng chứng quản trị là thứ không ai muốn phát hiện sau khi
    // đã chạy. Còn dòng thì dừng và in sẵn lệnh sao lưu.
    if (!(await queryRunner.hasTable('admin_action_logs'))) return;

    const [{ soDong }] = (await queryRunner.query(
      'SELECT COUNT(*) AS soDong FROM `admin_action_logs`',
    )) as Array<{ soDong: number }>;

    if (Number(soDong) > 0) {
      throw new Error(
        `admin_action_logs còn ${soDong} dòng nhật ký quản trị — không tự xoá.\n` +
          `Sao lưu trước rồi chạy lại:\n` +
          `  mysqldump -u root -p <db> admin_action_logs > admin_action_logs.sql\n` +
          `  mysql -u root -p -e "TRUNCATE TABLE <db>.admin_action_logs"`,
      );
    }

    await queryRunner.dropTable('admin_action_logs');
  }
}
