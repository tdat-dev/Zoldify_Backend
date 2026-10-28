/**
 * ĐO INDEX Ở CỠ LỚN: đổ ~650k dòng giả rồi EXPLAIN các câu nóng TRƯỚC và SAU
 * migration 1788500000000.
 *
 *   DB_DATABASE=zoldify_1mb npm run sql:explain-1m
 *
 * VÌ SAO KHÔNG DÙNG `check:index` LÀ ĐỦ. `check:index` hỏi lược đồ "có index
 * phủ chưa", độc lập với dữ liệu, và đó là thứ đúng để gác CI. Nhưng nó không
 * trả lời được "MySQL có CHỌN index đó không, và đỡ được bao nhiêu". Trên bảng
 * vài nghìn dòng, câu đó vô nghĩa: filesort 2.000 dòng mất 1ms, nhìn không ra
 * gì. Phải có cỡ bảng thật thì optimizer mới phải chọn.
 *
 * CÁCH ĐO.
 *   - `key` / `rows` / `Extra` từ EXPLAIN: MySQL ĐỊNH đi đường nào.
 *   - Tổng `Handler_read_*` của phiên sau khi chạy thật: số dòng MySQL ĐÃ đọc
 *     (index + bảng). Đây là con số không nói dối: `rows` của EXPLAIN chỉ là
 *     ước lượng, và với LIMIT đi theo index nó in ra cả trăm nghìn trong khi
 *     thật ra chỉ đọc 20.
 *   - Thời gian: trung vị 3 lần chạy (lần đầu nạp buffer pool, bỏ qua).
 *   - Lúc chạy `up()` trên bảng đã đầy, một kết nối khác liên tục UPDATE
 *     `products`: độ trễ lớn nhất của nó cho biết `LOCK=NONE` có thật không
 *     chặn ghi.
 *
 * DỮ LIỆU sinh bằng INSERT ... SELECT từ một bảng số (tích chéo các chữ số),
 * không vòng lặp Node: 200k dòng trong vài giây chứ không vài phút.
 *
 * CHẶN CỨNG: script XOÁ SẠCH users/products/orders/... rồi đổ rác. Tên
 * database phải chứa "1m" hoặc "explain".
 */
import AppDataSource from '../src/data-source';
import { AddHotListIndexesFor1M1788500000000 as Mig } from '../src/migrations/1788500000000-AddHotListIndexesFor1M';
import type { QueryRunner } from 'typeorm';

const DB = process.env.DB_DATABASE || '';
if (!/1m|explain/i.test(DB) || DB === 'zoldify') {
  console.error(
    `Từ chối: DB_DATABASE = "${DB}". Script này xoá sạch rồi đổ dữ liệu giả;` +
      ' tên database phải chứa "1m" hoặc "explain".',
  );
  process.exit(1);
}

const CO = {
  users: 50_000,
  sellers: 1_000,
  categories: 20,
  products: 200_000,
  orders: 100_000,
  conversations: 20_000,
  messages: 100_000,
};

// Người bán số 1 có đúng 20 hội thoại (c % 1000 = 0), dùng cho câu đếm tin
// chưa đọc: đúng hình dạng "danh sách hội thoại của tôi, kèm chấm đỏ".
const HOI_THOAI_CUA_NB1 = Array.from({ length: 20 }, (_, i) => (i + 1) * 1000);

interface Cau {
  ten: string;
  sql: string;
}

const CAU: Cau[] = [
  {
    ten: 'SP mới nhất (status, created_at)',
    sql: `SELECT p.id, p.name, p.price, c.name AS cat, u.full_name
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            LEFT JOIN users u ON u.id = p.seller_id
           WHERE p.status = 'active' AND p.deleted_at IS NULL
           ORDER BY p.created_at DESC LIMIT 20`,
  },
  {
    ten: 'SP giá tăng (status, price)',
    sql: `SELECT p.id, p.name, p.price FROM products p
           WHERE p.status = 'active' AND p.deleted_at IS NULL
           ORDER BY p.price ASC LIMIT 20`,
  },
  {
    ten: 'SP bán chạy (status, sold_count)',
    sql: `SELECT p.id, p.name, p.price FROM products p
           WHERE p.status = 'active' AND p.deleted_at IS NULL
           ORDER BY p.sold_count DESC LIMIT 20`,
  },
  {
    ten: 'SP xem nhiều (status, view_count)',
    sql: `SELECT p.id, p.name, p.price FROM products p
           WHERE p.status = 'active' AND p.deleted_at IS NULL
           ORDER BY p.view_count DESC LIMIT 20`,
  },
  {
    ten: 'SP theo danh mục (category, status, created_at)',
    sql: `SELECT p.id, p.name, p.price FROM products p
           WHERE p.category_id = 7 AND p.status = 'active' AND p.deleted_at IS NULL
           ORDER BY p.created_at DESC LIMIT 20`,
  },
  {
    ten: 'Đơn admin lọc pending (status, created_at)',
    sql: `SELECT o.id, o.order_code, o.final_amount FROM orders o
           WHERE o.status = 'pending' AND o.deleted_at IS NULL
           ORDER BY o.created_at DESC LIMIT 20`,
  },
  {
    ten: 'Vận đơn tới hạn tự chốt (status, received_at, delivered_at)',
    sql: `SELECT s.id, s.order_id, s.seller_id FROM order_shipments s
           INNER JOIN orders o ON o.id = s.order_id
           WHERE s.status = 'delivered' AND s.received_at IS NULL
             AND s.delivered_at < NOW() - INTERVAL 3 DAY
             AND o.status NOT IN ('cancelled', 'refunded')`,
  },
  {
    ten: 'Đếm tin chưa đọc theo hội thoại (conv, is_read, sender)',
    sql: `SELECT m.conversation_id, COUNT(*) AS so FROM messages m
           WHERE m.conversation_id IN (${HOI_THOAI_CUA_NB1.join(',')})
             AND m.is_read = 0 AND m.sender_id <> 1
           GROUP BY m.conversation_id`,
  },
  {
    ten: 'Người dùng mới nhất (created_at)',
    sql: `SELECT u.id, u.email FROM users u WHERE u.deleted_at IS NULL
           ORDER BY u.created_at DESC LIMIT 20`,
  },
  {
    ten: 'Ký quỹ admin lọc holding (status, created_at)',
    sql: `SELECT e.id, e.amount FROM escrows e WHERE e.status = 'holding'
           ORDER BY e.created_at DESC LIMIT 20`,
  },
];

interface SoDo {
  key: string;
  rows: number;
  extra: string;
  doc: number; // tổng Handler_read_* = số dòng thật sự đọc
  ms: number;
}

async function doMot(qr: QueryRunner, sql: string): Promise<SoDo> {
  // Lấy dòng EXPLAIN của bảng chính (bảng đầu tiên trong FROM). Câu JOIN thì
  // dòng đầu là bảng optimizer chọn đọc trước, thường đúng là bảng đó.
  const ex: Array<{ key: string | null; rows: number; Extra: string | null }> =
    await qr.query(`EXPLAIN ${sql}`);
  const e = ex[0];

  await qr.query(sql); // nạp buffer pool, không tính
  const lan: number[] = [];
  let doc = 0;
  for (let i = 0; i < 3; i++) {
    await qr.query('FLUSH STATUS');
    const t = process.hrtime.bigint();
    await qr.query(sql);
    lan.push(Number(process.hrtime.bigint() - t) / 1e6);
    const st: Array<{ Variable_name: string; Value: string }> = await qr.query(
      "SHOW SESSION STATUS LIKE 'Handler_read%'",
    );
    doc = st.reduce((s, r) => s + Number(r.Value), 0);
  }
  lan.sort((a, b) => a - b);
  return {
    key: e.key ?? 'NULL',
    rows: Number(e.rows),
    extra: e.Extra ?? '',
    doc,
    ms: Math.round(lan[1] * 10) / 10,
  };
}

async function doTatCa(qr: QueryRunner): Promise<SoDo[]> {
  const kq: SoDo[] = [];
  for (const c of CAU) kq.push(await doMot(qr, c.sql));
  return kq;
}

async function doDem(qr: QueryRunner, bang: string): Promise<number> {
  const [{ n }]: Array<{ n: string }> = await qr.query(
    `SELECT COUNT(*) AS n FROM \`${bang}\``,
  );
  return Number(n);
}

/** Đổ dữ liệu. Toàn bộ bằng INSERT ... SELECT từ bảng số `_so_1m`. */
async function doDuLieu(qr: QueryRunner): Promise<void> {
  const t0 = Date.now();
  const buoc = async (ten: string, sql: string) => {
    const t = Date.now();
    await qr.query(sql);
    console.log(`  ${ten.padEnd(16)} ${((Date.now() - t) / 1000).toFixed(1)}s`);
  };
  await qr.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const b of [
    'messages',
    'conversations',
    'escrows',
    'order_shipments',
    'order_items',
    'orders',
    'products',
    'categories',
    'users',
  ]) {
    await qr.query(`TRUNCATE TABLE \`${b}\``);
  }

  // Bảng số 1..200.000: tích chéo sáu lần mười chữ số. Bảng THƯỜNG chứ không
  // TEMPORARY, vì MySQL không cho mở cùng một bảng tạm hai lần trong một câu.
  await qr.query('DROP TABLE IF EXISTS `_chu_so_1m`');
  await qr.query('DROP TABLE IF EXISTS `_so_1m`');
  await qr.query('CREATE TABLE `_chu_so_1m` (d INT PRIMARY KEY)');
  await qr.query(
    'INSERT INTO `_chu_so_1m` VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)',
  );
  await qr.query('CREATE TABLE `_so_1m` (n INT PRIMARY KEY)');
  await buoc(
    '_so_1m',
    `INSERT INTO _so_1m
     SELECT 1 + a.d + 10*b.d + 100*c.d + 1000*d.d + 10000*e.d + 100000*f.d
       FROM _chu_so_1m a, _chu_so_1m b, _chu_so_1m c, _chu_so_1m d,
            _chu_so_1m e, _chu_so_1m f
      WHERE f.d < 2`,
  );

  await buoc(
    'categories',
    `INSERT INTO categories (id, name)
     SELECT n, CONCAT('Danh muc ', n) FROM _so_1m WHERE n <= ${CO.categories}`,
  );

  // ~1 người dùng / 10 phút trong 347 ngày. 1.000 người đầu là người bán.
  await buoc(
    'users',
    `INSERT INTO users (id, full_name, email, password, role, created_at)
     SELECT n, CONCAT('Nguoi dung ', n), CONCAT('u', n, '@1m.local'),
            '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRS',
            IF(n <= ${CO.sellers}, 'seller', 'buyer'),
            NOW() - INTERVAL n * 600 SECOND
       FROM _so_1m WHERE n <= ${CO.users}`,
  );

  // 80% active, còn lại chia đều sold/pending/draft/rejected: đúng tỉ lệ mà
  // làm idx_status gần như vô dụng cho lọc (MySQL vẫn phải gom 160k dòng).
  await buoc(
    'products',
    `INSERT INTO products (id, name, price, stock, status, sold_count,
                           view_count, category_id, seller_id, created_at)
     SELECT n, CONCAT('San pham ', n), 1000 + (n * 7919) % 5000000, 5,
            ELT(1 + n % 20, 'sold', 'pending', 'draft', 'rejected',
                'active', 'active', 'active', 'active', 'active', 'active',
                'active', 'active', 'active', 'active', 'active', 'active',
                'active', 'active', 'active', 'active'),
            (n * 31) % 500, (n * 97) % 10000,
            1 + n % ${CO.categories}, 1 + n % ${CO.sellers},
            NOW() - INTERVAL n * 150 SECOND
       FROM _so_1m WHERE n <= ${CO.products}`,
  );

  // 7 trạng thái chia đều: pending ~14%.
  await buoc(
    'orders',
    `INSERT INTO orders (id, order_code, receiver_name, receiver_phone,
                         shipping_address, user_id, status, final_amount,
                         created_at)
     SELECT n, CONCAT('ORD1M', n), 'Nguoi nhan', '0900000000', 'Dia chi',
            ${CO.sellers} + 1 + n % (${CO.users} - ${CO.sellers}),
            ELT(1 + n % 7, 'pending', 'confirmed', 'processing', 'shipping',
                'delivered', 'cancelled', 'refunded'),
            100000 + n % 900000, NOW() - INTERVAL n * 300 SECOND
       FROM _so_1m WHERE n <= ${CO.orders}`,
  );

  // Phần lớn đã nhận (trạng thái cuối); 5% đang 'delivered' chờ chốt, một
  // nửa trong số đó đã quá 3 ngày. Đó là tập job tự chốt phải tìm ra.
  await buoc(
    'order_shipments',
    `INSERT INTO order_shipments (order_id, seller_id, status, delivered_at,
                                  received_at)
     SELECT n, 1 + n % ${CO.sellers},
            CASE WHEN n % 20 = 0 THEN 'delivered'
                 WHEN n % 20 = 1 THEN 'created'
                 WHEN n % 20 = 2 THEN 'failed'
                 ELSE 'received' END,
            CASE WHEN n % 20 = 0 THEN NOW() - INTERVAL (n % 7) DAY
                 WHEN n % 20 >= 3 THEN NOW() - INTERVAL 10 DAY END,
            CASE WHEN n % 20 >= 3 THEN NOW() - INTERVAL 9 DAY END
       FROM _so_1m WHERE n <= ${CO.orders}`,
  );

  await buoc(
    'escrows',
    `INSERT INTO escrows (order_id, buyer_id, seller_id, amount, status,
                          created_at)
     SELECT n, ${CO.sellers} + 1 + n % (${CO.users} - ${CO.sellers}),
            1 + n % ${CO.sellers}, 100000 + n % 900000,
            ELT(1 + n % 4, 'holding', 'released', 'refunded', 'cancelled'),
            NOW() - INTERVAL n * 300 SECOND
       FROM _so_1m WHERE n <= ${CO.orders}`,
  );

  // Hội thoại c: người mua 1000+c, người bán 1 + c % 1000, sản phẩm c.
  await buoc(
    'conversations',
    `INSERT INTO conversations (id, buyer_id, seller_id, product_id)
     SELECT n, ${CO.sellers} + n, 1 + n % ${CO.sellers}, n
       FROM _so_1m WHERE n <= ${CO.conversations}`,
  );

  // 5 tin mỗi hội thoại, xen kẽ người mua / người bán, 10% chưa đọc.
  await buoc(
    'messages',
    `INSERT INTO messages (conversation_id, sender_id, content, is_read,
                           created_at)
     SELECT 1 + n % ${CO.conversations},
            IF(n % 2 = 0, ${CO.sellers} + 1 + n % ${CO.conversations},
                          1 + (1 + n % ${CO.conversations}) % ${CO.sellers}),
            CONCAT('Tin nhan ', n), IF(n % 10 = 0, 0, 1),
            NOW() - INTERVAL n * 60 SECOND
       FROM _so_1m WHERE n <= ${CO.messages}`,
  );

  await qr.query('SET FOREIGN_KEY_CHECKS = 1');
  await qr.query('DROP TABLE `_so_1m`');
  await qr.query('DROP TABLE `_chu_so_1m`');
  for (const b of [
    'users',
    'products',
    'orders',
    'order_shipments',
    'messages',
    'escrows',
  ]) {
    await qr.query(`ANALYZE TABLE \`${b}\``);
  }
  console.log(
    `Đổ dữ liệu xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s:`,
  );
  for (const b of [
    'users',
    'products',
    'orders',
    'order_shipments',
    'conversations',
    'messages',
    'escrows',
  ]) {
    console.log(
      `  ${b.padEnd(16)} ${(await doDem(qr, b)).toLocaleString('vi-VN')}`,
    );
  }
}

/**
 * Chạy `up()` trong lúc một kết nối khác liên tục UPDATE products, ghi lại độ
 * trễ từng lần ghi. Online DDL thật thì đa số lần ghi ở mức mili-giây; nếu
 * ALTER khoá bảng thì các lần ghi xếp hàng suốt thời gian dựng index.
 */
interface KetQuaUp {
  upMs: number;
  soLanGhi: number;
  p50: number;
  p99: number;
  lauNhat: number;
  lauNhatLuc: number; // ms kể từ lúc up() bắt đầu
  tren200: number;
}

async function upKemGhiSongSong(qr: QueryRunner): Promise<KetQuaUp> {
  const ghi = AppDataSource.createQueryRunner();
  await ghi.connect();
  let dung = false;
  const tre: Array<{ ms: number; luc: number }> = [];
  const t0 = Date.now();
  const vongGhi = (async () => {
    let id = 1;
    while (!dung) {
      const t = Date.now();
      await ghi.query(
        'UPDATE products SET view_count = view_count + 1 WHERE id = ?',
        [id],
      );
      tre.push({ ms: Date.now() - t, luc: t - t0 });
      id = (id % CO.products) + 1;
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  let upMs = 0;
  try {
    await new Mig().up(qr);
    upMs = Date.now() - t0;
  } finally {
    dung = true;
    await vongGhi;
    await ghi.release();
  }
  const xep = tre.map((x) => x.ms).sort((x, y) => x - y);
  const pv = (q: number) =>
    xep[Math.min(xep.length - 1, Math.floor(q * xep.length))];
  const max = tre.reduce((m, x) => (x.ms > m.ms ? x : m), { ms: 0, luc: 0 });
  return {
    upMs,
    soLanGhi: tre.length,
    p50: pv(0.5),
    p99: pv(0.99),
    lauNhat: max.ms,
    lauNhatLuc: max.luc,
    tren200: tre.filter((x) => x.ms > 200).length,
  };
}

function inBang(truoc: SoDo[], sau: SoDo[]): void {
  console.log(
    '\n| Câu | key trước | key sau | rows ước lượng trước → sau | dòng đọc thật trước → sau | ms trước → sau | Extra sau |',
  );
  console.log('|---|---|---|---|---|---|---|');
  CAU.forEach((c, i) => {
    const a = truoc[i];
    const b = sau[i];
    console.log(
      `| ${c.ten} | ${a.key} | ${b.key} | ${a.rows} → ${b.rows} | ` +
        `${a.doc} → ${b.doc} | ${a.ms} → ${b.ms} | ${b.extra} |`,
    );
  });
  console.log('\nExtra TRƯỚC (để thấy filesort):');
  CAU.forEach((c, i) => console.log(`  ${c.ten}: ${truoc[i].extra}`));
}

async function main(): Promise<void> {
  const ds = await AppDataSource.initialize();
  const qr = ds.createQueryRunner();
  await qr.connect();
  try {
    const daChay: unknown[] = await qr.query(
      'SELECT 1 FROM migrations WHERE timestamp = 1788500000000',
    );
    if (daChay.length === 0) {
      throw new Error('Chạy `npm run migration:run` trên database này trước.');
    }
    console.log(`Database: ${DB}\n`);
    await doDuLieu(qr);

    // TRƯỚC: lược đồ như staging hôm nay (down() của chính migration).
    await new Mig().down(qr);
    const truoc = await doTatCa(qr);

    // Chạy down() lần nữa để chứng minh nó bỏ qua được thứ đã gỡ.
    await new Mig().down(qr);

    const up = await upKemGhiSongSong(qr);
    // up() lần hai: phải là no-op (chạy lại sau một lần hỏng giữa chừng).
    const t = Date.now();
    await new Mig().up(qr);
    const upLai = Date.now() - t;
    for (const b of [
      'products',
      'orders',
      'order_shipments',
      'messages',
      'users',
      'escrows',
    ]) {
      await qr.query(`ANALYZE TABLE \`${b}\``);
    }
    const sau = await doTatCa(qr);

    inBang(truoc, sau);
    console.log(
      `\nup() trên bảng đầy: ${up.upMs}ms. Song song ${up.soLanGhi} lần ` +
        `UPDATE products: p50 ${up.p50}ms, p99 ${up.p99}ms, lâu nhất ` +
        `${up.lauNhat}ms (ở mốc ${up.lauNhatLuc}ms), ${up.tren200} lần > 200ms.`,
    );
    console.log(`up() lần hai (đã đủ index): ${upLai}ms, không ALTER nào.`);

    // Khoá ngoại wallet_id phải còn index đỡ sau khi idx_wallet bị xoá.
    const [tao]: Array<{ 'Create Table': string }> = await qr.query(
      'SHOW CREATE TABLE wallet_transactions',
    );
    const dong = tao['Create Table']
      .split('\n')
      .filter((l) => /KEY|CONSTRAINT/.test(l))
      .map((l) => '  ' + l.trim());
    console.log('\nSHOW CREATE TABLE wallet_transactions (khoá + index):');
    console.log(dong.join('\n'));
  } finally {
    await qr.release();
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error('LỖI explain-1m:', e);
  process.exit(1);
});
