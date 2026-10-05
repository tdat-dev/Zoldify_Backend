/**
 * ĐỔ DỮ LIỆU CHO BÀI SOI SQL (`npm run sql:audit`).
 *
 * Vì sao cần file này: `EXPLAIN` trên bảng rỗng luôn đẹp. MySQL thấy bảng 0
 * dòng thì chọn đường nào cũng "rows=1", nên một truy vấn quét toàn bảng vẫn
 * trông y hệt một truy vấn có index. Muốn biết chỗ nào CHẬM thì phải có dòng
 * thật để nó phải chọn.
 *
 * `seed:products` + `seed:orders` đã lo phần catalog/đơn hàng (2.000 sản phẩm,
 * 1.000 đơn). File này lấp nốt những bảng còn rỗng — chat, đánh giá, ví, thanh
 * toán, rút tiền, thông báo, vận đơn — vì đó chính là chỗ các list nặng nằm.
 *
 * Chỉ chạy trên DB soi (mặc định `zoldify_sqlaudit`). Có chặn cứng ở dưới:
 * tên database phải chứa `audit`, để không ai lỡ tay đổ 2.400 tin nhắn giả vào
 * DB thật.
 *
 *   npm run sql:audit:seed
 */
import * as mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const DB = process.env.DB_DATABASE || 'zoldify_sqlaudit';

// Chặn cứng. Đây là script đổ RÁC có chủ đích — nó chỉ vô hại khi chắc chắn
// đang chạy trên DB dùng một lần.
if (!/audit/i.test(DB)) {
  console.error(
    `✋ Từ chối: DB_DATABASE = "${DB}" — tên phải chứa "audit".\n` +
      '   File này đổ dữ liệu giả, chỉ dành cho DB soi dùng một lần.',
  );
  process.exit(1);
}

const CFG: mysql.PoolOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3307,
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'testpw',
  database: DB,
  connectionLimit: 5,
};

/** Chèn theo lô. mysql2 cho phép `VALUES ?` với mảng-của-mảng. */
async function chen(
  pool: mysql.Pool,
  bang: string,
  cot: string[],
  hang: unknown[][],
): Promise<number> {
  if (hang.length === 0) return 0;
  const [r] = await pool.query<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO ${bang} (${cot.join(',')}) VALUES ?`,
    [hang],
  );
  return r.affectedRows;
}

/** Thời điểm rải đều trong 180 ngày qua — để ORDER BY created_at có việc làm. */
function luc(i: number, tong: number): Date {
  const ngay = 180 * (1 - i / Math.max(tong, 1));
  return new Date(Date.now() - ngay * 24 * 3600 * 1000);
}

async function main(): Promise<void> {
  const pool = mysql.createPool(CFG);
  const dem: Record<string, number> = {};

  // ─── Người dùng ───────────────────────────────────────────────────────────
  // 3 người (seller/buyer/admin) là quá ít: mọi truy vấn "WHERE user_id" sẽ
  // trúng 1/3 số dòng, và MySQL sẽ bỏ index để quét bảng — đúng kỹ thuật,
  // nhưng khiến bài soi không nói được gì. 60 người thì tỉ lệ lọc mới thật.
  const nguoi: unknown[][] = [];
  for (let i = 0; i < 60; i++) {
    const vai = i % 3 === 0 ? 'seller' : 'buyer';
    nguoi.push([
      `Nguoi dung soi ${i}`,
      `audit${i}@zoldify.local`,
      '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRS',
      vai,
      1,
      luc(i, 60),
    ]);
  }
  dem.users = await chen(
    pool,
    'users',
    ['full_name', 'email', 'password', 'role', 'email_verified', 'created_at'],
    nguoi,
  );

  const [uRows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id, role FROM users ORDER BY id',
  );
  const idNguoi = uRows.map((r) => Number(r.id));
  const idBan = uRows.filter((r) => r.role === 'seller').map((r) => Number(r.id));
  const idMua = uRows.filter((r) => r.role !== 'seller').map((r) => Number(r.id));

  const [pRows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id FROM products ORDER BY id LIMIT 1000',
  );
  const idHang = pRows.map((r) => Number(r.id));

  const [oRows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id FROM orders ORDER BY id LIMIT 1000',
  );
  const idDon = oRows.map((r) => Number(r.id));

  const chon = <T>(a: T[], i: number): T => a[i % a.length];

  // ─── Cửa hàng ─────────────────────────────────────────────────────────────
  // shops.user_id là UNIQUE (mỗi người một shop), nên số shop tối đa = số seller.
  dem.shops = await chen(
    pool,
    'shops',
    ['name', 'slug', 'description', 'phone', 'address', 'status', 'user_id'],
    idBan
      .slice(0, 15)
      .map((uid, i) => [
        `Shop soi ${i}`,
        `shop-soi-${i}`,
        'Cua hang dung cho bai soi SQL',
        '0900000000',
        'So 1 duong Soi',
        'active',
        uid,
      ]),
  );

  // ─── Địa chỉ ──────────────────────────────────────────────────────────────
  const diaChi: unknown[][] = [];
  idNguoi.slice(0, 40).forEach((uid, i) => {
    for (let k = 0; k < 2; k++) {
      diaChi.push([
        `Nguoi nhan ${i}-${k}`,
        '0911222333',
        k === 0 ? 'Nha rieng' : 'Co quan',
        'VN',
        'Ha Noi',
        'Cau Giay',
        'Dich Vong',
        `So ${i * 10 + k} pho Soi`,
        k === 0 ? 1 : 0,
        uid,
      ]);
    }
  });
  dem.addresses = await chen(
    pool,
    'addresses',
    [
      'recipient_name',
      'phone_number',
      'label',
      'country',
      'province',
      'district',
      'ward',
      'street',
      'is_default',
      'user_id',
    ],
    diaChi,
  );

  // ─── Đánh giá ─────────────────────────────────────────────────────────────
  // UNIQUE (user_id, product_id) — nên ghép cặp không trùng: mỗi người đánh giá
  // một dải sản phẩm riêng.
  const danhGia: unknown[][] = [];
  let d = 0;
  for (const uid of idMua.slice(0, 30)) {
    for (let k = 0; k < 20 && d < 600; k++, d++) {
      danhGia.push([
        (d % 5) + 1,
        `Nhan xet soi so ${d}`,
        uid,
        idHang[d % idHang.length],
        luc(d, 600),
      ]);
    }
  }
  dem.reviews = await chen(
    pool,
    'reviews',
    ['rating', 'comment', 'user_id', 'product_id', 'created_at'],
    danhGia,
  );

  // ─── Hội thoại + tin nhắn ─────────────────────────────────────────────────
  // Đây là bảng quan trọng nhất của bài soi: `getMyConversations` từng là chỗ
  // N+1 nặng nhất (201 truy vấn). Không có dòng thì không chứng minh lại được.
  const hoiThoai: unknown[][] = [];
  for (let i = 0; i < 120; i++) {
    hoiThoai.push([
      chon(idMua, i),
      chon(idBan, i),
      idHang[i % idHang.length],
      luc(i, 120),
      luc(i, 120),
    ]);
  }
  dem.conversations = await chen(
    pool,
    'conversations',
    ['buyer_id', 'seller_id', 'product_id', 'created_at', 'updated_at'],
    hoiThoai,
  );

  const [cRows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id, buyer_id, seller_id FROM conversations ORDER BY id',
  );
  const tinNhan: unknown[][] = [];
  cRows.forEach((c, i) => {
    for (let k = 0; k < 30; k++) {
      tinNhan.push([
        `Tin nhan ${i}-${k}`,
        k % 3 === 0 ? 0 : 1,
        k % 2 === 0 ? c.buyer_id : c.seller_id,
        c.id,
        luc(i * 30 + k, cRows.length * 30),
      ]);
    }
  });
  dem.messages = await chen(
    pool,
    'messages',
    ['content', 'is_read', 'sender_id', 'conversation_id', 'created_at'],
    tinNhan,
  );

  // ─── Theo dõi ─────────────────────────────────────────────────────────────
  const theoDoi: unknown[][] = [];
  for (let i = 0; i < idMua.length; i++) {
    for (let k = 0; k < 8; k++) {
      const a = idMua[i];
      const b = idBan[(i + k) % idBan.length];
      if (a !== b) theoDoi.push([a, b]);
    }
  }
  dem.follows = await chen(pool, 'follows', ['follower_id', 'following_id'], theoDoi);

  // ─── Ví + lịch sử giao dịch ───────────────────────────────────────────────
  dem.wallets = await chen(
    pool,
    'wallets',
    ['balance', 'user_id'],
    idNguoi.slice(0, 50).map((uid, i) => [(i + 1) * 100000, uid]),
  );
  const [wRows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT id FROM wallets ORDER BY id',
  );
  const idVi = wRows.map((r) => Number(r.id));
  const gd: unknown[][] = [];
  const loai = ['topup', 'payment', 'refund', 'withdrawal'];
  idVi.forEach((wid, i) => {
    for (let k = 0; k < 20; k++) {
      const n = i * 20 + k;
      gd.push([
        50000,
        100000,
        150000,
        loai[n % 4],
        `REF-${n}`,
        wid,
        luc(n, idVi.length * 20),
      ]);
    }
  });
  dem.wallet_transactions = await chen(
    pool,
    'wallet_transactions',
    [
      'amount',
      'balance_before',
      'balance_after',
      'type',
      'reference',
      'wallet_id',
      'created_at',
    ],
    gd,
  );

  // ─── Thanh toán ───────────────────────────────────────────────────────────
  const pp = ['cod', 'bank_transfer', 'wallet', 'payos'];
  const tt = ['pending', 'success', 'failed'];
  dem.payments = await chen(
    pool,
    'payments',
    [
      'amount',
      'payment_method',
      'transaction_code',
      'status',
      'type',
      'order_id',
      'user_id',
      'created_at',
    ],
    idDon
      .slice(0, 600)
      .map((oid, i) => [
        (i + 1) * 1000,
        pp[i % 4],
        `TXN-SOI-${i}`,
        tt[i % 3],
        'order_payment',
        oid,
        chon(idMua, i),
        luc(i, 600),
      ]),
  );

  // ─── Rút tiền ─────────────────────────────────────────────────────────────
  const tr = ['pending', 'approved', 'rejected', 'completed'];
  const rut: unknown[][] = [];
  idBan.forEach((uid, i) => {
    for (let k = 0; k < 15; k++) {
      const n = i * 15 + k;
      rut.push([
        (n + 1) * 10000,
        'Vietcombank',
        `00${n}`,
        `Chu tai khoan ${n}`,
        tr[n % 4],
        uid,
        luc(n, idBan.length * 15),
      ]);
    }
  });
  dem.withdrawals = await chen(
    pool,
    'withdrawals',
    [
      'amount',
      'bank_name',
      'bank_account',
      'bank_holder',
      'status',
      'user_id',
      'created_at',
    ],
    rut,
  );

  // ─── Thông báo ────────────────────────────────────────────────────────────
  const lt = ['order_status', 'review', 'payment', 'system', 'message', 'new_product'];
  const tb: unknown[][] = [];
  idNguoi.forEach((uid, i) => {
    for (let k = 0; k < 25; k++) {
      const n = i * 25 + k;
      tb.push([
        lt[n % 6],
        `Thong bao soi ${n}`,
        'Noi dung thong bao dung cho bai soi SQL',
        n % 3 === 0 ? 0 : 1,
        uid,
        luc(n, idNguoi.length * 25),
      ]);
    }
  });
  dem.notifications = await chen(
    pool,
    'notifications',
    ['type', 'title', 'content', 'is_read', 'user_id', 'created_at'],
    tb,
  );

  // ─── Vận đơn ──────────────────────────────────────────────────────────────
  // UNIQUE (order_id, seller_id) — mỗi đơn một lô cho mỗi người bán.
  const ts = ['created', 'delivered', 'received', 'failed'];
  dem.order_shipments = await chen(
    pool,
    'order_shipments',
    ['order_id', 'seller_id', 'tracking_code', 'cod_amount', 'status'],
    idDon
      .slice(0, 500)
      .map((oid, i) => [oid, chon(idBan, i), `GHN-SOI-${i}`, 100000, ts[i % 4]]),
  );

  console.log('Đã đổ dữ liệu cho bài soi SQL:');
  for (const [k, v] of Object.entries(dem)) {
    console.log(`  ${k.padEnd(22)} +${v}`);
  }

  const [tong] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT table_name AS t, table_rows AS n FROM information_schema.tables
      WHERE table_schema = ? AND table_rows > 0 ORDER BY table_rows DESC`,
    [DB],
  );
  console.log('\nSố dòng hiện có (ước lượng của MySQL):');
  for (const r of tong) console.log(`  ${String(r.t).padEnd(22)} ${r.n}`);

  await pool.end();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
