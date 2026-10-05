/**
 * BỘ TỰ KIỂM RÀNG BUỘC DATABASE — viết TEST TRƯỚC.
 *
 * Cùng khuôn với `selfcheck-indexes.ts`: chạy BÂY GIỜ phải ĐỎ ở đúng những bất
 * biến mà database chưa tự bảo vệ. Thêm migration xong, chạy lại phải XANH.
 *
 * Chạy:
 *   npm run check:constraints
 *   (cần lược đồ ĐÃ CHẠY MIGRATION — xem CI, bước "Dựng schema thật để soi")
 *
 * VÌ SAO KHÔNG VIẾT BẰNG JEST. Các spec tiền dùng `synchronize: true`, mà
 * TypeORM **không sinh ràng buộc CHECK trên MySQL** — `@Check()` bị driver bỏ
 * qua. Nên một bài kiểm chạy trên lược đồ synchronize sẽ mãi mãi đỏ dù migration
 * đã đúng. Phải đo trên lược đồ thật do migration dựng, và đó chính là thứ CI
 * đã dựng sẵn cho `check:index`.
 *
 * VÌ SAO PHẢI INSERT THẬT, KHÔNG ĐỌC `information_schema`.
 * MySQL trước 8.0.16 **phân tích cú pháp CHECK rồi bỏ qua trong im lặng** —
 * ràng buộc hiện ra đầy đủ trong `information_schema.CHECK_CONSTRAINTS` mà
 * không chặn gì cả. Một bài kiểm đọc metadata sẽ báo xanh trên đúng cái máy chủ
 * nguy hiểm nhất. Nên ở đây ghi dữ liệu sai thật rồi xem database có từ chối
 * không; câu trả lời đó không nói dối được.
 *
 * CA ĐỐI CHỨNG. Ba ca `control: true` là thứ ĐÃ bị chặn từ trước (khoá UNIQUE
 * có sẵn). Chúng phải PASS ngay từ lần chạy đầu — nếu chúng cũng đỏ thì lỗi nằm
 * ở bộ kiểm này, không phải ở lược đồ. Không có chúng thì "toàn đỏ" và "harness
 * hỏng" trông giống hệt nhau.
 */
import AppDataSource from '../src/data-source';
import type { QueryRunner } from 'typeorm';

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};

interface Ca {
  /** Bất biến đang kiểm, viết như một lời khẳng định. */
  ten: string;
  /** Câu SQL CỐ TÌNH SAI. Database phải từ chối nó. */
  sql: string;
  params: unknown[];
  /** Migration đề xuất khi ca này đỏ. */
  vaBang?: string;
  /** true = đã có khoá chặn từ trước, phải PASS ngay lần chạy đầu. */
  control?: boolean;
}

/**
 * `QueryRunner.query` khai kiểu trả về là `QueryResult<any>` (không phải mảng,
 * và không nhận tham số kiểu) nên phải bọc lại một lần. Bọc ở đây để phần thân
 * bên dưới khỏi rải `as` lên từng dòng.
 */
async function hoi<T>(
  qr: QueryRunner,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await qr.query(sql, params)) as T[];
}

/** Dữ liệu nền tối thiểu để có khoá ngoại hợp lệ. Tạo trong transaction rồi bỏ. */
interface Nen {
  buyerId: number;
  sellerId: number;
  categoryId: number;
  productId: number;
  orderId: number;
}

async function dungNen(qr: QueryRunner): Promise<Nen> {
  const moc = `ck-${Date.now()}`;

  await qr.query(
    `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', 'buyer')`,
    [moc, `${moc}-b@t.local`],
  );
  const [b] = await hoi<{ id: number }>(qr, `SELECT id FROM users WHERE email = ?`, [`${moc}-b@t.local`]);

  await qr.query(
    `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', 'seller')`,
    [moc, `${moc}-s@t.local`],
  );
  const [s] = await hoi<{ id: number }>(qr, `SELECT id FROM users WHERE email = ?`, [`${moc}-s@t.local`]);

  await qr.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
    moc,
    moc,
  ]);
  const [c] = await hoi<{ id: number }>(qr, `SELECT id FROM categories WHERE slug = ?`, [moc]);

  await qr.query(
    `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
     VALUES (?, ?, 100000, 10, 'active', ?, ?)`,
    [moc, moc, c.id, s.id],
  );
  const [p] = await hoi<{ id: number }>(qr, `SELECT id FROM products WHERE slug = ?`, [moc]);

  await qr.query(
    `INSERT INTO orders (order_code, user_id, total_amount, shipping_fee, final_amount,
       status, payment_method, receiver_name, receiver_phone, shipping_address)
     VALUES (?, ?, 100000, 0, 100000, 'pending', 'cod', 'T', '0900000000', 'addr')`,
    [moc, b.id],
  );
  const [o] = await hoi<{ id: number }>(qr, `SELECT id FROM orders WHERE order_code = ?`, [moc]);

  return {
    buyerId: b.id,
    sellerId: s.id,
    categoryId: c.id,
    productId: p.id,
    orderId: o.id,
  };
}

function danhSachCa(n: Nen): Ca[] {
  const ma = `ck2-${Date.now()}`;
  return [
    // ── ĐỐI CHỨNG: đã có khoá chặn, phải PASS ngay ────────────────────────
    {
      ten: '[đối chứng] orders.order_code trùng bị từ chối',
      sql: `INSERT INTO orders (order_code, user_id, total_amount, shipping_fee, final_amount,
              status, payment_method, receiver_name, receiver_phone, shipping_address)
            SELECT order_code, user_id, 1, 0, 1, 'pending', 'cod', 'T', '0900000000', 'addr'
              FROM orders WHERE id = ?`,
      params: [n.orderId],
      control: true,
    },
    {
      ten: '[đối chứng] carts trùng (user, product) bị từ chối',
      sql: `INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1), (?, ?, 1)`,
      params: [n.buyerId, n.productId, n.buyerId, n.productId],
      control: true,
    },
    {
      ten: '[đối chứng] order_shipments trùng (order, seller) bị từ chối',
      sql: `INSERT INTO order_shipments (order_id, seller_id, cod_amount, status)
            VALUES (?, ?, 0, 'created'), (?, ?, 0, 'created')`,
      params: [n.orderId, n.sellerId, n.orderId, n.sellerId],
      control: true,
    },

    // ── TỒN KHO ───────────────────────────────────────────────────────────
    {
      ten: 'products.stock không được âm',
      sql: `UPDATE products SET stock = -1 WHERE id = ?`,
      params: [n.productId],
      vaBang: "ALTER TABLE products ADD CONSTRAINT chk_products_stock CHECK (stock >= 0)",
    },
    {
      ten: 'products.price không được âm',
      sql: `UPDATE products SET price = -1 WHERE id = ?`,
      params: [n.productId],
      vaBang: "ALTER TABLE products ADD CONSTRAINT chk_products_price CHECK (price >= 0)",
    },

    // ── MÓN TRONG ĐƠN ─────────────────────────────────────────────────────
    {
      ten: 'order_items.quantity phải lớn hơn 0',
      sql: `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
            VALUES (?, ?, 'x', 1000, 0, 0)`,
      params: [n.orderId, n.productId],
      vaBang:
        'ALTER TABLE order_items ADD CONSTRAINT chk_order_items_quantity CHECK (quantity > 0)',
    },
    {
      ten: 'order_items.subtotal không được âm',
      sql: `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
            VALUES (?, ?, 'x', 1000, 1, -1)`,
      params: [n.orderId, n.productId],
      vaBang:
        'ALTER TABLE order_items ADD CONSTRAINT chk_order_items_subtotal CHECK (subtotal >= 0)',
    },

    // ── ĐƠN HÀNG ──────────────────────────────────────────────────────────
    {
      ten: 'orders.final_amount không được âm',
      sql: `UPDATE orders SET final_amount = -1 WHERE id = ?`,
      params: [n.orderId],
      vaBang:
        'ALTER TABLE orders ADD CONSTRAINT chk_orders_final_amount CHECK (final_amount >= 0)',
    },
    {
      ten: 'orders.shipping_fee không được âm',
      sql: `UPDATE orders SET shipping_fee = -1 WHERE id = ?`,
      params: [n.orderId],
      vaBang:
        'ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_fee CHECK (shipping_fee >= 0)',
    },

    // ── KÝ QUỸ ────────────────────────────────────────────────────────────
    {
      ten: 'escrows.amount không được âm',
      sql: `INSERT INTO escrows (order_id, buyer_id, seller_id, amount, shipping_amount, status)
            VALUES (?, ?, ?, -1, 0, 'holding')`,
      params: [n.orderId, n.buyerId, n.sellerId],
      vaBang:
        'ALTER TABLE escrows ADD CONSTRAINT chk_escrows_amount CHECK (amount >= 0)',
    },
    {
      ten: 'escrows.shipping_amount không được âm',
      sql: `INSERT INTO escrows (order_id, buyer_id, seller_id, amount, shipping_amount, status)
            VALUES (?, ?, ?, 0, -1, 'holding')`,
      params: [n.orderId, n.buyerId, n.sellerId],
      vaBang:
        'ALTER TABLE escrows ADD CONSTRAINT chk_escrows_shipping CHECK (shipping_amount >= 0)',
    },
    {
      // Mã đã chặn bằng `if (already > 0)`. Nhưng hai request song song cùng đọc
      // thấy 0 rồi cùng ghi — đúng cái bẫy mà `orders.create` phải khoá hàng để
      // tránh. Hai khoản ký quỹ cho một người bán = giải ngân hai lần.
      ten: 'escrows không được trùng (order, seller)',
      sql: `INSERT INTO escrows (order_id, buyer_id, seller_id, amount, shipping_amount, status)
            VALUES (?, ?, ?, 1000, 0, 'holding'), (?, ?, ?, 1000, 0, 'holding')`,
      params: [
        n.orderId,
        n.buyerId,
        n.sellerId,
        n.orderId,
        n.buyerId,
        n.sellerId,
      ],
      vaBang:
        'ALTER TABLE escrows ADD UNIQUE KEY uq_escrow_order_seller (order_id, seller_id)',
    },

    // ── RÚT TIỀN ──────────────────────────────────────────────────────────
    {
      ten: 'withdrawals.amount phải lớn hơn 0',
      sql: `INSERT INTO withdrawals (user_id, amount, bank_name, bank_account, bank_holder, status)
            VALUES (?, 0, ?, '123', ?, 'pending')`,
      params: [n.sellerId, ma, ma],
      vaBang:
        'ALTER TABLE withdrawals ADD CONSTRAINT chk_withdrawals_amount CHECK (amount > 0)',
    },
  ];
}

async function main() {
  const ds = await AppDataSource.initialize();

  const [{ v }] = (await ds.query('SELECT VERSION() AS v')) as Array<{
    v: string;
  }>;
  console.log('\x1b[1m═══ TỰ KIỂM RÀNG BUỘC DATABASE ═══\x1b[0m');
  console.log(`MySQL ${v} · lược đồ: ${ds.options.database as string}\n`);

  // CHECK chỉ được thực thi từ MySQL 8.0.16. Dưới mức đó thì mọi ca sẽ đỏ dù
  // migration đúng — nói ra ngay thay vì để người đọc tự đoán.
  const [major, minor, patch] = v.split('-')[0].split('.').map(Number);
  const duMuc =
    major > 8 || (major === 8 && (minor > 0 || (minor === 0 && patch >= 16)));
  if (!duMuc) {
    console.log(
      `\x1b[33m⚠ MySQL ${v} PHÂN TÍCH CÚ PHÁP CHECK RỒI BỎ QUA TRONG IM LẶNG.\x1b[0m`,
    );
    console.log('  Cần 8.0.16 trở lên thì ràng buộc mới có tác dụng.\n');
  }

  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();

  try {
    const nen = await dungNen(qr);

    for (const ca of danhSachCa(nen)) {
      // SAVEPOINT cho từng ca: một câu bị từ chối không làm hỏng các ca sau.
      await qr.query('SAVEPOINT ca');
      let biTuChoi = false;
      try {
        await qr.query(ca.sql, ca.params);
      } catch {
        biTuChoi = true;
      }
      await qr.query('ROLLBACK TO SAVEPOINT ca');

      if (biTuChoi) {
        ok(ca.ten);
      } else if (ca.control) {
        bad(
          `${ca.ten} — CA ĐỐI CHỨNG ĐỎ nghĩa là bộ kiểm này hỏng, không phải lược đồ thiếu`,
        );
      } else {
        bad(`${ca.ten} — database VẪN NHẬN dữ liệu sai`);
      }
    }
  } finally {
    await qr.rollbackTransaction();
    await qr.release();
    await ds.destroy();
  }

  console.log('');
  if (failures > 0) {
    console.log('\x1b[1mMigration cần để chuyển XANH:\x1b[0m');
    for (const ca of danhSachCa({
      buyerId: 0,
      sellerId: 0,
      categoryId: 0,
      productId: 0,
      orderId: 0,
    })) {
      if (ca.vaBang) console.log(`  ${ca.vaBang};`);
    }
    console.log('');
  }
  console.log(
    failures === 0
      ? '\x1b[1m\x1b[32m═══ KẾT QUẢ: TẤT CẢ PASS ✓ (database tự bảo vệ được) ═══\x1b[0m'
      : `\x1b[1m\x1b[31m═══ KẾT QUẢ: ${failures} FAIL ✗ (bất biến chỉ có mã bảo vệ) ═══\x1b[0m`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\x1b[31mLỖI CHẠY TỰ KIỂM RÀNG BUỘC:\x1b[0m', e);
  process.exit(2);
});
