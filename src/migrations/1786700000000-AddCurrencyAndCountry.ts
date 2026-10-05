import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thêm `products.currency`, `orders.currency` và `addresses.country`.
 *
 * VẤN ĐỀ ĐANG CHỮA: không cột nào trong hệ thống nói một số tiền thuộc tiền tệ
 * gì. Mọi con số đều NGẦM là đồng Việt Nam, và cái ngầm đó chỉ đúng chừng nào
 * còn đúng một nước. Đo được: bật giao diện sang tiếng Anh thì giá vẫn in
 * "1.890.000 ₫" — không phải lỗi định dạng mà là thiếu dữ liệu để định dạng.
 *
 * ⚠️ PHẠM VI — đọc trước khi tưởng đã xong:
 * Ba cột này làm đúng phần HIỂN THỊ và phần GHI NHẬN. Chúng KHÔNG khiến sàn
 * giao dịch được xuyên tiền tệ. Còn thiếu:
 *   · nguồn tỉ giá và thời điểm chốt giá;
 *   · sổ cái nhiều tiền tệ — ledger_accounts hiện kiểm `sum(entries) = 0`, bất
 *     biến đó chỉ có nghĩa TRONG CÙNG một tiền tệ, trộn hai loại vào một sổ là
 *     làm hỏng sổ sách mà không ai thấy;
 *   · quy tắc ký quỹ và hoàn tiền khi hai bên khác tiền tệ.
 * Nên tới lúc có thiết kế đó, mỗi sàn vẫn chạy MỘT tiền tệ; các cột này chỉ
 * khiến điều đó trở thành lựa chọn tường minh thay vì một giả định im lặng.
 *
 * MẶC ĐỊNH KHÔNG PHẢI PHỎNG ĐOÁN: mọi dòng đang có đều nhập bằng bộ chọn
 * tỉnh/huyện/xã Việt Nam và tính bằng đồng, nên 'VND'/'VN' đúng với dữ liệu cũ.
 *
 * Chiều lùi xoá cả ba cột. An toàn: không cột nào chứa thông tin không suy lại
 * được — trước migration này cả hệ thống vốn đã ngầm hiểu là VND/VN.
 */
export class AddCurrencyAndCountry1786700000000 implements MigrationInterface {
  name = 'AddCurrencyAndCountry1786700000000';

  /**
   * Thêm cột nếu chưa có.
   *
   * Kiểm trước khi thêm vì database dev của nhóm đã từng chạy qua
   * `synchronize: true` — cột có thể đã tồn tại ở máy này mà chưa ở máy khác.
   * Không kiểm thì migration chết giữa chừng ở đúng những máy đó.
   */
  private async addIfMissing(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    definition: string,
  ) {
    const found = await queryRunner.getTable(table);
    if (found && !found.findColumnByName(column)) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` ADD \`${column}\` ${definition}`,
      );
    }
  }

  private async dropIfPresent(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ) {
    const found = await queryRunner.getTable(table);
    if (found?.findColumnByName(column)) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``,
      );
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addIfMissing(
      queryRunner,
      'products',
      'currency',
      "char(3) NOT NULL DEFAULT 'VND'",
    );
    await this.addIfMissing(
      queryRunner,
      'orders',
      'currency',
      "char(3) NOT NULL DEFAULT 'VND'",
    );
    await this.addIfMissing(
      queryRunner,
      'addresses',
      'country',
      "char(2) NOT NULL DEFAULT 'VN'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIfPresent(queryRunner, 'addresses', 'country');
    await this.dropIfPresent(queryRunner, 'orders', 'currency');
    await this.dropIfPresent(queryRunner, 'products', 'currency');
  }
}
