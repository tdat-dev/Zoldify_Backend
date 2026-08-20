/**
 * Seed dữ liệu QUY MÔ LỚN để đo tải (Task 0.1 của kế hoạch tối ưu DB).
 *
 * Khác với seed-1000-*.ts (chèn từng dòng, chỉ hợp demo), script này sinh tới
 * hàng TRIỆU dòng mà không phình bộ nhớ và không sập:
 *
 *   1. Chèn hàng loạt   — mỗi câu INSERT gộp ~1000 dòng.
 *   2. Commit theo lô    — cắt transaction mỗi ~50k dòng, không gói một cục.
 *   3. Không giữ bảng cha trong RAM — tham chiếu id bằng số học trên dải
 *      AUTO_INCREMENT liên tục vừa tạo (seed local không có ghi đồng thời).
 *   4. Sinh xác định theo chỉ số — order_items tái tạo được snapshot sản phẩm
 *      mà khỏi query lại products.
 *   5. Tránh trùng khoá UNIQUE bằng số học (dòng k -> cặp (k%B, k%P)), không
 *      random — random ở cỡ triệu chắc chắn đụng ER_DUP_ENTRY.
 *   6. Băm mật khẩu MỘT lần rồi dùng lại cho mọi user.
 *   7. Tắt foreign_key_checks / unique_checks trong lúc nạp cho InnoDB nhanh.
 *
 * KHÔNG đụng nhóm bảng tiền (ledger_*, wallets, escrows, payments…): sổ cái kép
 * có bất biến SUM(ledger_entries.amount)=0, bơm dòng giả vào đó là làm hỏng sổ
 * sách. Xem lý do trong plan.
 *
 * Cách chạy (phải `npm run seed` trước để có categories):
 *   npm run seed:bulk                                   # mặc định (orders 1tr)
 *   npm run seed:bulk -- --products 5000 --orders 10000 # chạy thử nhỏ
 *   npm run seed:bulk -- --reset                        # xoá dữ liệu bulk cũ rồi seed lại
 */
import { DataSource, QueryRunner } from 'typeorm';
import { hashSync } from 'bcrypt';
import { config } from 'dotenv';
config();

// ─────────────────────────── Tham số dòng lệnh ───────────────────────────
function argNum(flag: string, def: number): number {
  // Nhận cả hai dạng: "--flag 123" và "--flag=123". Dạng '=' sống sót khi đi
  // qua `npm run ... --` (npm hay nuốt cặp "--flag value" thành config của nó).
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  let raw: string | undefined;
  if (eq) {
    raw = eq.slice(flag.length + 1);
  } else {
    const i = process.argv.indexOf(flag);
    if (i === -1) return def;
    raw = process.argv[i + 1];
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`Giá trị không hợp lệ cho ${flag}: ${raw}`);
  }
  return Math.floor(v);
}
const RESET = process.argv.includes('--reset');

const SELLERS = argNum('--sellers', 10_000);
const BUYERS = argNum('--buyers', 500_000);
const PRODUCTS = argNum('--products', 500_000);
const ORDERS = argNum('--orders', 1_000_000);
const REVIEWS = argNum('--reviews', 500_000);
const CARTS = argNum('--carts', 500_000);
const FOLLOWS = argNum('--follows', 500_000);
const CONVERSATIONS = argNum('--conversations', 500_000);
const MESSAGES = argNum('--messages', 500_000);
const NOTIFICATIONS = argNum('--notifications', 500_000);

const BATCH = argNum('--batch', 1_000); // số dòng mỗi câu INSERT
const COMMIT_EVERY = argNum('--commit-every', 50_000); // commit sau mỗi bao nhiêu dòng

// ─────────────────────────── Tiện ích chung ───────────────────────────
const HASH = hashSync('123456', 10); // băm một lần, dùng cho mọi user
const PRODUCT_IMG =
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&h=500&fit=crop';
const BIG = 2_654_435_761; // hằng nhân Knuth để rải chỉ số

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** Cặp (user, product) không trùng nếu N ≤ lcm(B,P): dòng k -> (k%B, k%P). */
function assertPairFits(name: string, n: number, b: number, p: number) {
  const limit = lcm(b, p);
  if (n > limit) {
    throw new Error(
      `${name}=${n} vượt lcm(${b},${p})=${limit}; sẽ trùng khoá UNIQUE. ` +
        `Giảm ${name} hoặc tăng số buyers/products.`,
    );
  }
}

// Sinh xác định cho sản phẩm thứ k (0-based) — phải khớp lúc chèn products,
// để order_items tái tạo snapshot mà khỏi đọc lại DB.
const productPrice = (k: number) => 20_000 + (k % 50) * 10_000; // 20k..510k
const productName = (k: number) => `San pham so ${k}`;

function fmt(n: number) {
  return n.toLocaleString('en-US');
}

// ─────────────────────────── Nạp theo lô ───────────────────────────
/**
 * Đọc từ generator (mỗi phần tử là 1 mảng cột), gộp thành INSERT nhiều dòng,
 * commit sau mỗi COMMIT_EVERY dòng. Trả về số dòng đã chèn.
 */
async function insertFromGenerator(
  qr: QueryRunner,
  label: string,
  table: string,
  columns: string[],
  gen: Iterable<any[]>,
): Promise<number> {
  const colList = columns.map((c) => `\`${c}\``).join(', ');
  const rowPh = '(' + columns.map(() => '?').join(', ') + ')';
  let buffer: any[][] = [];
  let inserted = 0;
  let sinceCommit = 0;
  const t0 = Date.now();

  const flush = async () => {
    if (buffer.length === 0) return;
    const sql =
      `INSERT INTO \`${table}\` (${colList}) VALUES ` +
      new Array(buffer.length).fill(rowPh).join(', ');
    const params: any[] = [];
    for (const row of buffer) params.push(...row);
    await qr.query(sql, params);
    inserted += buffer.length;
    sinceCommit += buffer.length;
    buffer = [];
    if (sinceCommit >= COMMIT_EVERY) {
      await qr.commitTransaction();
      await qr.startTransaction();
      sinceCommit = 0;
      process.stdout.write(`\r  ${label}: ${fmt(inserted)}...`);
    }
  };

  for (const row of gen) {
    buffer.push(row);
    if (buffer.length >= BATCH) await flush();
  }
  await flush();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`\r  ${label}: ${fmt(inserted)} ✓  (${secs}s)\n`);
  return inserted;
}

async function maxId(qr: QueryRunner, table: string): Promise<number> {
  const [row] = await qr.query(`SELECT COALESCE(MAX(id), 0) AS m FROM \`${table}\``);
  return Number(row.m);
}

/**
 * Id THỰC TẾ của bản ghi ĐẦU TIÊN vừa chèn vào `table` (dòng có id lớn hơn
 * `prevMax` — mốc chụp NGAY TRƯỚC khi chèn).
 *
 * Vì sao không đoán `MAX(id)+1`: sau mỗi lần DELETE (kể cả `--reset`), MySQL
 * KHÔNG hạ AUTO_INCREMENT. Nên id thật của bản ghi mới có thể bắt đầu cao hơn
 * hẳn `MAX(id)+1`. Nếu bảng con cứ trỏ theo công thức `MAX(id)+1 + k` thì lệch
 * đúng bằng khoảng trống đó → sinh hàng loạt bản ghi MỒ CÔI. Đọc id đầu thực tế
 * rồi cộng chỉ số (các dòng chèn liên tiếp trên một kết nối là liền mạch) mới
 * đúng bất kể lịch sử xoá.
 */
async function firstInsertedId(
  qr: QueryRunner,
  table: string,
  prevMax: number,
): Promise<number> {
  const [row] = await qr.query(
    `SELECT MIN(id) AS m FROM \`${table}\` WHERE id > ?`,
    [prevMax],
  );
  const m = Number(row?.m);
  if (!m) {
    throw new Error(`Khong xac dinh duoc id dau tien vua chen vao \`${table}\``);
  }
  return m;
}

/**
 * GUARD TOÀN VẸN THAM CHIẾU — chạy sau khi seed xong. Vì lúc nạp có tắt
 * foreign_key_checks (để nhanh), không có gì tự chặn khoá ngoại hỏng. Hàm này
 * kiểm mọi quan hệ con→cha: còn dù MỘT dòng mồ côi là NÉM LỖI để seed thất bại
 * rõ ràng, không bao giờ âm thầm giao dữ liệu bẩn nữa.
 */
async function assertNoOrphans(qr: QueryRunner) {
  // [bảng con, cột khoá ngoại, bảng cha]
  const rels: [string, string, string][] = [
    ['products', 'seller_id', 'users'],
    ['orders', 'user_id', 'users'],
    ['order_items', 'order_id', 'orders'],
    ['order_items', 'product_id', 'products'],
    ['reviews', 'user_id', 'users'],
    ['reviews', 'product_id', 'products'],
    ['carts', 'user_id', 'users'],
    ['carts', 'product_id', 'products'],
    ['follows', 'follower_id', 'users'],
    ['follows', 'following_id', 'users'],
    ['conversations', 'buyer_id', 'users'],
    ['conversations', 'seller_id', 'users'],
    ['conversations', 'product_id', 'products'],
    ['messages', 'conversation_id', 'conversations'],
    ['messages', 'sender_id', 'users'],
    ['notifications', 'user_id', 'users'],
  ];
  console.log('🔎 Kiểm toàn vẹn tham chiếu (không được có dòng mồ côi)...');
  for (const [child, fk, parent] of rels) {
    const [row] = await qr.query(
      `SELECT COUNT(*) AS c FROM \`${child}\` ch
       LEFT JOIN \`${parent}\` p ON p.id = ch.\`${fk}\`
       WHERE ch.\`${fk}\` IS NOT NULL AND p.id IS NULL`,
    );
    const c = Number(row.c);
    if (c > 0) {
      throw new Error(
        `Toan ven tham chieu HONG: ${child}.${fk} -> ${parent} co ${c} dong mo coi. ` +
          `Seed DUNG lai de khong giao du lieu ban.`,
      );
    }
    console.log(`   ✓ ${child}.${fk} → ${parent}`);
  }
}

// ─────────────────────────── Xoá dữ liệu bulk (--reset) ───────────────────────────
async function doReset(qr: QueryRunner) {
  console.log('↺ --reset: xoá dữ liệu bulk cũ (không đụng seed nền)...');
  const bulkBuyers = `(SELECT id FROM users WHERE email LIKE 'bulkbuyer+%')`;
  const bulkUsers = `(SELECT id FROM users WHERE email LIKE 'bulkseller+%' OR email LIKE 'bulkbuyer+%')`;
  const bulkProducts = `(SELECT id FROM products WHERE slug LIKE 'bulk-prod-%')`;
  const bulkOrders = `(SELECT id FROM orders WHERE order_code LIKE 'ZLD-BULK-%')`;
  // Thứ tự con -> cha. foreign_key_checks đã tắt nên không cần lo ràng buộc.
  const steps: [string, string][] = [
    ['messages', `DELETE FROM messages WHERE sender_id IN ${bulkBuyers}`],
    ['conversations', `DELETE FROM conversations WHERE buyer_id IN ${bulkBuyers}`],
    ['follows', `DELETE FROM follows WHERE follower_id IN ${bulkBuyers}`],
    ['notifications', `DELETE FROM notifications WHERE user_id IN ${bulkUsers}`],
    ['carts', `DELETE FROM carts WHERE user_id IN ${bulkBuyers}`],
    ['reviews', `DELETE FROM reviews WHERE user_id IN ${bulkBuyers} OR product_id IN ${bulkProducts}`],
    ['order_items', `DELETE FROM order_items WHERE order_id IN ${bulkOrders}`],
    ['orders', `DELETE FROM orders WHERE order_code LIKE 'ZLD-BULK-%'`],
    ['products', `DELETE FROM products WHERE slug LIKE 'bulk-prod-%'`],
    ['users', `DELETE FROM users WHERE email LIKE 'bulkseller+%' OR email LIKE 'bulkbuyer+%'`],
  ];
  for (const [name, sql] of steps) {
    const res = await qr.query(sql);
    const n = res?.affectedRows ?? 0;
    console.log(`  - ${name}: xoá ${fmt(n)} dòng`);
  }
}

// ─────────────────────────── Chương trình chính ───────────────────────────
async function main() {
  const database = process.env.DB_DATABASE || '';
  if (!/_(dev|test)$/.test(database)) {
    throw new Error(
      `Từ chối seed lên "${database}". Chỉ chạy với CSDL tên kết thúc _dev hoặc _test.`,
    );
  }

  // Kiểm ràng buộc UNIQUE trước khi tốn công chèn.
  assertPairFits('reviews', REVIEWS, BUYERS, PRODUCTS);
  assertPairFits('carts', CARTS, BUYERS, PRODUCTS);
  assertPairFits('follows', FOLLOWS, BUYERS, SELLERS);
  assertPairFits('conversations', CONVERSATIONS, BUYERS, lcm(SELLERS, PRODUCTS));

  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    synchronize: false,
    logging: ['error'],
  });
  await ds.initialize();
  console.log(`🔌 Kết nối ${database}\n`);

  const qr = ds.createQueryRunner();
  await qr.connect();
  const startAll = Date.now();

  await qr.query('SET SESSION foreign_key_checks = 0');
  await qr.query('SET SESSION unique_checks = 0');

  try {
    // Tiền đề: phải có categories (chạy `npm run seed` trước).
    const cats: { id: number }[] = await qr.query(
      `SELECT id FROM categories ORDER BY id`,
    );
    if (cats.length === 0) {
      throw new Error(
        'Chưa có category nào. Chạy `npm run seed` trước rồi mới seed:bulk.',
      );
    }
    const catIds = cats.map((c) => c.id);

    if (RESET) await doReset(qr);

    await qr.startTransaction();

    // 1) SELLERS
    const usersBeforeSellers = await maxId(qr, 'users');
    console.log(`① users (sellers) x${fmt(SELLERS)}`);
    await insertFromGenerator(
      qr,
      'sellers',
      'users',
      ['full_name', 'email', 'password', 'role', 'email_verified'],
      (function* () {
        for (let k = 0; k < SELLERS; k++) {
          yield [`Seller ${k}`, `bulkseller+${k}@zoldify.test`, HASH, 'seller', 1];
        }
      })(),
    );
    const firstSeller = await firstInsertedId(qr, 'users', usersBeforeSellers);
    const sellerId = (k: number) => firstSeller + (k % SELLERS);

    // 2) BUYERS
    const usersBeforeBuyers = await maxId(qr, 'users');
    console.log(`② users (buyers) x${fmt(BUYERS)}`);
    await insertFromGenerator(
      qr,
      'buyers',
      'users',
      ['full_name', 'email', 'password', 'role', 'email_verified'],
      (function* () {
        for (let k = 0; k < BUYERS; k++) {
          yield [`Buyer ${k}`, `bulkbuyer+${k}@zoldify.test`, HASH, 'buyer', 1];
        }
      })(),
    );
    const firstBuyer = await firstInsertedId(qr, 'users', usersBeforeBuyers);
    const buyerId = (k: number) => firstBuyer + (k % BUYERS);

    // 3) PRODUCTS
    const productsBefore = await maxId(qr, 'products');
    console.log(`③ products x${fmt(PRODUCTS)}`);
    await insertFromGenerator(
      qr,
      'products',
      'products',
      ['name', 'slug', 'price', 'currency', 'stock', 'image', 'description', 'brand', 'category_id', 'seller_id', 'status'],
      (function* () {
        for (let k = 0; k < PRODUCTS; k++) {
          yield [
            productName(k),
            `bulk-prod-${k}`,
            productPrice(k),
            'VND',
            100,
            PRODUCT_IMG,
            `Mo ta san pham so ${k}. Hang chinh hang, chat luong tot, gia hop ly, giao nhanh.`,
            'BulkBrand',
            catIds[k % catIds.length],
            sellerId(k),
            'active',
          ];
        }
      })(),
    );
    const firstProduct = await firstInsertedId(qr, 'products', productsBefore);

    // 4) ORDERS + ORDER_ITEMS (sinh xác định theo chỉ số đơn)
    const statuses = ['pending', 'processing', 'shipping', 'delivered', 'cancelled'];
    const itemCount = (oi: number) => 1 + (oi % 3); // 1..3
    const itemProductIdx = (oi: number, j: number) => (oi * 7 + j * 13) % PRODUCTS;
    const itemQty = (oi: number, j: number) => 1 + ((oi + j) % 3); // 1..3
    const orderTotal = (oi: number) => {
      let t = 0;
      const n = itemCount(oi);
      for (let j = 0; j < n; j++) {
        t += productPrice(itemProductIdx(oi, j)) * itemQty(oi, j);
      }
      return t;
    };
    const YEAR = 365 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const orderStatus = (oi: number) => {
      const r = (oi * 2_654_435_761) % 100; // rải ổn định 0..99
      if (r < 70) return 'delivered';
      if (r < 80) return 'pending';
      if (r < 90) return 'processing';
      if (r < 95) return 'shipping';
      return 'cancelled';
    };

    const ordersBefore = await maxId(qr, 'orders');
    console.log(`④ orders x${fmt(ORDERS)}`);
    await insertFromGenerator(
      qr,
      'orders',
      'orders',
      ['order_code', 'user_id', 'total_amount', 'shipping_fee', 'final_amount', 'currency', 'status', 'payment_method', 'is_paid', 'paid_at', 'receiver_name', 'receiver_phone', 'shipping_address', 'created_at', 'updated_at'],
      (function* () {
        for (let oi = 0; oi < ORDERS; oi++) {
          const total = orderTotal(oi);
          const status = orderStatus(oi);
          const payment = oi % 2 === 0 ? 'cod' : 'payos';
          const paid =
            (payment === 'payos' && status !== 'cancelled') ||
            (payment === 'cod' && status === 'delivered');
          const createdAt = new Date(now - Math.floor(Math.random() * YEAR));
          yield [
            `ZLD-BULK-${oi}`,
            buyerId(oi),
            total,
            0,
            total,
            'VND',
            status,
            payment,
            paid ? 1 : 0,
            paid ? createdAt : null,
            'Nguyen Van Mua',
            '0901234567',
            '123 Nguyen Van Cu, Quan 5, TP.HCM',
            createdAt,
            createdAt,
          ];
        }
      })(),
    );

    const firstOrder = await firstInsertedId(qr, 'orders', ordersBefore);
    console.log(`⑤ order_items (1-3 mỗi đơn)`);
    await insertFromGenerator(
      qr,
      'order_items',
      'order_items',
      ['order_id', 'product_id', 'product_name', 'product_image', 'price', 'quantity', 'subtotal'],
      (function* () {
        for (let oi = 0; oi < ORDERS; oi++) {
          const n = itemCount(oi);
          for (let j = 0; j < n; j++) {
            const pk = itemProductIdx(oi, j);
            const qty = itemQty(oi, j);
            const price = productPrice(pk);
            yield [
              firstOrder + oi,
              firstProduct + pk,
              productName(pk),
              PRODUCT_IMG,
              price,
              qty,
              price * qty,
            ];
          }
        }
      })(),
    );

    // 6) REVIEWS — cặp (buyer, product) không trùng
    console.log(`⑥ reviews x${fmt(REVIEWS)}`);
    await insertFromGenerator(
      qr,
      'reviews',
      'reviews',
      ['user_id', 'product_id', 'rating', 'comment'],
      (function* () {
        for (let k = 0; k < REVIEWS; k++) {
          yield [
            firstBuyer + (k % BUYERS),
            firstProduct + (k % PRODUCTS),
            1 + (k % 5),
            `Danh gia so ${k}: san pham dung mo ta, giao nhanh.`,
          ];
        }
      })(),
    );

    // 7) CARTS — cặp (buyer, product) không trùng
    console.log(`⑦ carts x${fmt(CARTS)}`);
    await insertFromGenerator(
      qr,
      'carts',
      'carts',
      ['user_id', 'product_id', 'quantity'],
      (function* () {
        for (let k = 0; k < CARTS; k++) {
          yield [firstBuyer + (k % BUYERS), firstProduct + (k % PRODUCTS), 1 + (k % 3)];
        }
      })(),
    );

    // 8) FOLLOWS — cặp (buyer, seller) không trùng
    console.log(`⑧ follows x${fmt(FOLLOWS)}`);
    await insertFromGenerator(
      qr,
      'follows',
      'follows',
      ['follower_id', 'following_id'],
      (function* () {
        for (let k = 0; k < FOLLOWS; k++) {
          yield [firstBuyer + (k % BUYERS), firstSeller + (k % SELLERS)];
        }
      })(),
    );

    // 9) CONVERSATIONS — bộ ba (buyer, seller, product) không trùng
    const convBefore = await maxId(qr, 'conversations');
    console.log(`⑨ conversations x${fmt(CONVERSATIONS)}`);
    await insertFromGenerator(
      qr,
      'conversations',
      'conversations',
      ['buyer_id', 'seller_id', 'product_id'],
      (function* () {
        for (let k = 0; k < CONVERSATIONS; k++) {
          yield [
            firstBuyer + (k % BUYERS),
            firstSeller + (k % SELLERS),
            firstProduct + (k % PRODUCTS),
          ];
        }
      })(),
    );
    const firstConv = await firstInsertedId(qr, 'conversations', convBefore);

    // 10) MESSAGES — mỗi tin thuộc 1 conversation, người gửi là buyer của conv đó
    console.log(`⑩ messages x${fmt(MESSAGES)}`);
    await insertFromGenerator(
      qr,
      'messages',
      'messages',
      ['conversation_id', 'sender_id', 'content', 'is_read'],
      (function* () {
        for (let k = 0; k < MESSAGES; k++) {
          const c = k % CONVERSATIONS; // conversation index
          yield [
            firstConv + c,
            firstBuyer + (c % BUYERS), // buyer của conversation c
            `Tin nhan so ${k}: san pham con hang khong ban oi?`,
            k % 2,
          ];
        }
      })(),
    );

    // 11) NOTIFICATIONS
    const notifTypes = ['order_status', 'review', 'payment', 'system', 'message', 'new_product'];
    console.log(`⑪ notifications x${fmt(NOTIFICATIONS)}`);
    await insertFromGenerator(
      qr,
      'notifications',
      'notifications',
      ['user_id', 'type', 'title', 'content', 'is_read'],
      (function* () {
        for (let k = 0; k < NOTIFICATIONS; k++) {
          yield [
            firstBuyer + (k % BUYERS),
            notifTypes[k % notifTypes.length],
            `Thong bao ${k}`,
            `Noi dung thong bao so ${k}.`,
            k % 2,
          ];
        }
      })(),
    );

    if (qr.isTransactionActive) await qr.commitTransaction();

    // Chốt chặn: dữ liệu đã commit, kiểm toàn vẹn tham chiếu trước khi báo xong.
    await assertNoOrphans(qr);
  } catch (err) {
    if (qr.isTransactionActive) await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.query('SET SESSION foreign_key_checks = 1');
    await qr.query('SET SESSION unique_checks = 1');
    await qr.release();
  }

  const mins = ((Date.now() - startAll) / 60000).toFixed(1);
  console.log(`\n🎉 Seed xong sau ${mins} phút.`);
  await ds.destroy();
}

main().catch((e) => {
  console.error('\n❌ Seed thất bại:', e.message || e);
  process.exit(1);
});
