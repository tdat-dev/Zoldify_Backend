import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đưa các bất biến về tiền và tồn kho xuống tầng database.
 *
 * VÌ SAO. `orders.create` có một bình luận dài giải thích ba lớp chặn, trong đó
 * lớp thứ hai được giữ lại *"có chủ đích: mai kia ai đó gỡ khoá đi thì kho vẫn
 * không thể về âm, vì **database từ chối chứ không phải mã từ chối**"*.
 *
 * Nhưng tới 24/09 repo có **0 ràng buộc CHECK**. Lời hứa ấy mới làm được một
 * nửa: `WHERE stock >= :soLuong` là mã từ chối, không phải database từ chối.
 * Bất kỳ đường ghi nào không đi qua `orders.create` — script seed, sửa tay
 * bằng SQL, một service viết sau này — đều đặt được `stock = -1`.
 *
 * Đo bằng `npm run check:constraints`: trước migration này 10 FAIL, sau phải
 * 0 FAIL. Bộ kiểm đó INSERT dữ liệu sai thật chứ không đọc `information_schema`,
 * vì MySQL trước 8.0.16 phân tích cú pháp CHECK rồi bỏ qua trong im lặng.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * HAI THỨ CỐ Ý KHÔNG LÀM:
 *
 * 1. **`orders.total_amount` và `discount_amount`** — chưa ràng buộc. Khi có
 *    mã giảm giá thật thì `final_amount = total + ship − discount` có thể chạm
 *    những trường hợp mà hôm nay chưa ai định nghĩa. Đặt ràng buộc cho thứ
 *    mình chưa hiểu hết là tự dựng một cái bẫy phải gỡ lúc production đang lỗi.
 *
 * 2. **`ledger_entries.amount`** — bút toán ÂM là bình thường và cần thiết
 *    (chân "tiền ra"). Bất biến thật của sổ cái là `SUM(amount) = 0` theo từng
 *    giao dịch, mà MySQL không diễn đạt được bằng CHECK trên một dòng.
 *    `LedgerService.validateInput` vẫn là nơi giữ nó.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * NẾU MIGRATION NÀY DỪNG Ở BƯỚC KIỂM: nghĩa là production đang có dữ liệu vi
 * phạm sẵn. Đó là tin tốt — nó vừa tìm ra thứ mà không ai biết. Sửa dữ liệu
 * trước rồi chạy lại; đừng gỡ ràng buộc để migration đi qua.
 */
export class AddDatabaseConstraints1787600000000 implements MigrationInterface {
  name = 'AddDatabaseConstraints1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── BƯỚC 1: KIỂM DỮ LIỆU CŨ TRƯỚC KHI RÀNG BUỘC ──────────────────────
    //
    // `ALTER TABLE ... ADD CONSTRAINT` trên bảng đang có dòng vi phạm sẽ chết
    // giữa chừng với một thông báo MySQL chỉ nêu tên ràng buộc, không nêu dòng
    // nào sai. Kiểm trước rồi báo bằng tiếng người thì người trực production
    // biết ngay phải sửa gì.
    const kiem: Array<{ mo_ta: string; sql: string }> = [
      {
        mo_ta: 'products.stock âm',
        sql: 'SELECT COUNT(*) AS n FROM products WHERE stock < 0',
      },
      {
        mo_ta: 'products.price âm',
        sql: 'SELECT COUNT(*) AS n FROM products WHERE price < 0',
      },
      {
        mo_ta: 'order_items.quantity < 1',
        sql: 'SELECT COUNT(*) AS n FROM order_items WHERE quantity < 1',
      },
      {
        mo_ta: 'order_items.subtotal âm',
        sql: 'SELECT COUNT(*) AS n FROM order_items WHERE subtotal < 0',
      },
      {
        mo_ta: 'orders.final_amount âm',
        sql: 'SELECT COUNT(*) AS n FROM orders WHERE final_amount < 0',
      },
      {
        mo_ta: 'orders.shipping_fee âm',
        sql: 'SELECT COUNT(*) AS n FROM orders WHERE shipping_fee < 0',
      },
      {
        mo_ta: 'escrows.amount âm',
        sql: 'SELECT COUNT(*) AS n FROM escrows WHERE amount < 0',
      },
      {
        mo_ta: 'escrows.shipping_amount âm',
        sql: 'SELECT COUNT(*) AS n FROM escrows WHERE shipping_amount < 0',
      },
      {
        mo_ta: 'withdrawals.amount <= 0',
        sql: 'SELECT COUNT(*) AS n FROM withdrawals WHERE amount <= 0',
      },
      {
        mo_ta: 'escrows trùng (order_id, seller_id)',
        sql: `SELECT COUNT(*) AS n FROM (
                SELECT order_id, seller_id FROM escrows
                GROUP BY order_id, seller_id HAVING COUNT(*) > 1) t`,
      },
    ];

    const viPham: string[] = [];
    for (const k of kiem) {
      const rows = (await queryRunner.query(k.sql)) as Array<{ n: number }>;
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) viPham.push(`  · ${k.mo_ta}: ${n} dòng`);
    }

    if (viPham.length) {
      throw new Error(
        'Không thêm được ràng buộc: dữ liệu hiện có đang vi phạm.\n' +
          viPham.join('\n') +
          '\n\nSửa những dòng này trước rồi chạy lại migration. ĐỪNG gỡ ràng ' +
          'buộc để đi qua — chúng vừa tìm ra thứ mà không ai biết.',
      );
    }

    // ── BƯỚC 2: TỒN KHO VÀ GIÁ ───────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE \`products\` ADD CONSTRAINT \`chk_products_stock\` CHECK (\`stock\` >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`products\` ADD CONSTRAINT \`chk_products_price\` CHECK (\`price\` >= 0)`,
    );

    // ── BƯỚC 3: MÓN TRONG ĐƠN ────────────────────────────────────────────
    // `quantity > 0` chứ không phải `>= 0`: một dòng đơn hàng 0 món không có
    // nghĩa gì, và nó làm mọi phép tính tổng tiền trông vẫn đúng trong khi đơn
    // thì sai.
    await queryRunner.query(
      `ALTER TABLE \`order_items\` ADD CONSTRAINT \`chk_order_items_quantity\` CHECK (\`quantity\` > 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`order_items\` ADD CONSTRAINT \`chk_order_items_subtotal\` CHECK (\`subtotal\` >= 0)`,
    );

    // ── BƯỚC 4: ĐƠN HÀNG ─────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE \`orders\` ADD CONSTRAINT \`chk_orders_final_amount\` CHECK (\`final_amount\` >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`orders\` ADD CONSTRAINT \`chk_orders_shipping_fee\` CHECK (\`shipping_fee\` >= 0)`,
    );

    // ── BƯỚC 5: KÝ QUỸ ───────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE \`escrows\` ADD CONSTRAINT \`chk_escrows_amount\` CHECK (\`amount\` >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`escrows\` ADD CONSTRAINT \`chk_escrows_shipping\` CHECK (\`shipping_amount\` >= 0)`,
    );

    // MỘT NGƯỜI BÁN, MỘT KHOẢN KÝ QUỸ TRONG MỘT ĐƠN.
    //
    // `createOrderEscrows` đã chặn bằng `if (already > 0) return ...`. Nhưng đó
    // là đọc-rồi-ghi không khoá: hai request song song cùng đọc thấy 0 rồi cùng
    // ghi — đúng cái bẫy mà `orders.create` phải khoá hàng để tránh, và đúng
    // cái bẫy mà `updateStock` đã dính (xem BUG-06).
    //
    // Hai khoản ký quỹ cho một người bán nghĩa là giải ngân hai lần. Khác với
    // sổ cái, chỗ này KHÔNG có `idempotency_key` che cho, vì mỗi khoản có id
    // riêng nên hai lần `release` sinh ra hai khoá khác nhau.
    //
    // `order_shipments` đã có `uq_shipment_order_seller` cho đúng cặp cột này
    // từ task #26 — escrows chỉ là chỗ bị bỏ sót.
    await queryRunner.query(
      `ALTER TABLE \`escrows\` ADD UNIQUE INDEX \`uq_escrow_order_seller\` (\`order_id\`, \`seller_id\`)`,
    );

    // ── BƯỚC 6: RÚT TIỀN ─────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE \`withdrawals\` ADD CONSTRAINT \`chk_withdrawals_amount\` CHECK (\`amount\` > 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`withdrawals\` DROP CHECK \`chk_withdrawals_amount\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`escrows\` DROP INDEX \`uq_escrow_order_seller\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`escrows\` DROP CHECK \`chk_escrows_shipping\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`escrows\` DROP CHECK \`chk_escrows_amount\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`orders\` DROP CHECK \`chk_orders_shipping_fee\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`orders\` DROP CHECK \`chk_orders_final_amount\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`order_items\` DROP CHECK \`chk_order_items_subtotal\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`order_items\` DROP CHECK \`chk_order_items_quantity\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`products\` DROP CHECK \`chk_products_price\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`products\` DROP CHECK \`chk_products_stock\``,
    );
  }
}
