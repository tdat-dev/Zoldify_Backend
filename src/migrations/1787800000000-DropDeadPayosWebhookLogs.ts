import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xoá bảng chết `payos_webhook_logs`.
 *
 * VÌ SAO NÓ CHẾT. Bảng này từng giữ vai trò chống trùng cho webhook PayOS.
 * Vai trò đó đã chuyển sang `ledger_transactions.idempotency_key` — chỗ tốt
 * hơn hẳn, vì khoá nằm trong CÙNG transaction với việc cộng tiền.
 *
 * `payos.service.ts` ghi lại nguyên văn lý do đổi:
 *
 *   > Bản cũ gọi `save()` năm lần rời rạc, và tệ nhất là nó ghi dấu chống trùng
 *   > vào `payos_webhook_log` TRƯỚC rồi mới cộng tiền. Sập giữa hai bước đó thì
 *   > lần PayOS gửi lại sẽ bị coi là trùng và bỏ qua — khách mất tiền, ví không
 *   > có gì, không cảnh báo nào nổ ra vì cả hai bên đều tưởng đã xong.
 *
 * Từ đó không đường nào ghi vào bảng nữa. Đã kiểm 24/09: entity còn tồn tại và
 * còn đăng ký trong `PayosModule`, nhưng **không service nào tiêm nó vào**.
 *
 * VÌ SAO PHẢI XOÁ CHỨ KHÔNG ĐỂ ĐÓ. Nó xuất hiện trong ERD (25 bảng) và trong
 * `openapi.json`. Một bảng chết trong sơ đồ là một câu hỏi chắc chắn bị hỏi lúc
 * bảo vệ — và câu trả lời "bảng này không dùng nữa nhưng vẫn còn" thì không có
 * gì để nói thêm. Đã quyết bỏ thì bỏ hẳn.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * TỰ BẢO VỆ. Migration DỪNG nếu bảng còn dòng nào.
 *
 * Trên máy phát triển và staging bảng đang rỗng nên nó xoá thẳng. Nhưng không
 * ai ở đây đọc được production, nên nếu ở đó còn dữ liệu lịch sử thì migration
 * phải dừng và để CON NGƯỜI quyết định, chứ không tự xoá theo giả định.
 *
 * `DROP TABLE` là thao tác KHÔNG hoàn tác được bằng `down()` — `down()` dựng
 * lại được cái vỏ, không dựng lại được dữ liệu. Đó là lý do chỗ này cẩn thận
 * hơn mức bình thường.
 */
export class DropDeadPayosWebhookLogs1787800000000 implements MigrationInterface {
  name = 'DropDeadPayosWebhookLogs1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const coBang = (await queryRunner.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'payos_webhook_logs'`,
    )) as Array<{ n: number }>;

    // Đã xoá rồi (hoặc chưa bao giờ có) thì thôi — migration phải chạy lại được.
    if (Number(coBang[0]?.n ?? 0) === 0) return;

    const rows = (await queryRunner.query(
      'SELECT COUNT(*) AS n FROM `payos_webhook_logs`',
    )) as Array<{ n: number }>;
    const soDong = Number(rows[0]?.n ?? 0);

    if (soDong > 0) {
      throw new Error(
        `Bảng payos_webhook_logs còn ${soDong} dòng — KHÔNG tự xoá.\n\n` +
          'Bảng này không còn được ghi từ lần đổi sang ledger idempotency_key, ' +
          'nhưng dữ liệu cũ có thể vẫn cần cho đối soát.\n\n' +
          'Xuất ra trước nếu cần giữ:\n' +
          '  mysqldump -u root -p <db> payos_webhook_logs > payos_webhook_logs.sql\n\n' +
          'Rồi xoá sạch bảng và chạy lại migration:\n' +
          '  DELETE FROM payos_webhook_logs;\n\n' +
          'Đừng sửa migration này để bỏ qua bước kiểm.',
      );
    }

    await queryRunner.query('DROP TABLE `payos_webhook_logs`');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Dựng lại đúng cái vỏ mà InitialSchema tạo ra. DỮ LIỆU THÌ KHÔNG QUAY LẠI
    // — `up()` chỉ chạy khi bảng đã rỗng, nên không có gì để mất, nhưng nói rõ
    // ở đây để không ai trông chờ vào điều ngược lại.
    await queryRunner.query(
      'CREATE TABLE `payos_webhook_logs` (' +
        '`id` int NOT NULL AUTO_INCREMENT, ' +
        '`transaction_id` varchar(100) NOT NULL, ' +
        '`body` json NOT NULL, ' +
        '`processed` tinyint NOT NULL DEFAULT 0, ' +
        '`created_at` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), ' +
        'UNIQUE INDEX `idx_transaction_id` (`transaction_id`), ' +
        'PRIMARY KEY (`id`)) ENGINE=InnoDB',
    );
  }
}
