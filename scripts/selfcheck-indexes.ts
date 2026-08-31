/**
 * BỘ TỰ KIỂM INDEX (Epic 3 phần 2 — audit index toàn hệ) — viết TEST TRƯỚC.
 *
 * Vì sao tách khỏi selfcheck.ts: đây là bài test "red → green". Chạy BÂY GIỜ nó sẽ
 * ĐỎ ở đúng những list còn thiếu index ghép — đó chính là kết quả audit. Sau khi
 * thêm migration index, chạy lại phải XANH.
 *
 * Chạy:
 *   node -r ts-node/register -r tsconfig-paths/register scripts/selfcheck-indexes.ts
 *
 * CHỐT PHÁN XÉT = CẤU TRÚC, KHÔNG PHẢI SỐ DÒNG.
 * Seed hiện tại rải ~1 dòng/khoá nên EXPLAIN sẽ "xanh giả" (filesort 1 dòng là
 * miễn phí). App thật thì 1 user có hàng trăm thông báo, 1 sản phẩm hot có hàng
 * nghìn review → mới lộ filesort. Nên bài test hỏi: "CÓ tồn tại index ghép
 * (khoá_lọc, created_at) để ORDER BY khỏi filesort dù khoá có bao nhiêu dòng
 * không?" — trả lời từ schema, độc lập với phân bố dữ liệu. EXPLAIN chỉ để minh hoạ.
 */
import AppDataSource from '../src/data-source';

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};

/** Một mẫu truy cập danh sách nặng của app: WHERE (filter) ORDER BY orderCol DESC. */
interface Pattern {
  name: string; //         nơi trong code
  table: string;
  filter: string[]; //     cột trong WHERE (rỗng = list toàn bảng, vd admin)
  orderCol: string; //     cột ORDER BY
  explainSql: string; //   câu SQL thật để EXPLAIN minh hoạ
  params: any[];
  control?: boolean; //    true = kỳ vọng ĐÃ XANH (chứng minh test không phải lúc nào cũng đỏ)
}

// Lấy leftmost-prefix các cột của mọi index trên 1 bảng.
async function indexPrefixes(ds: typeof AppDataSource, table: string): Promise<string[][]> {
  const rows: Array<{ INDEX_NAME: string; COLUMN_NAME: string; SEQ_IN_INDEX: number }> =
    await ds.query(
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [table],
    );
  const byName = new Map<string, string[]>();
  for (const r of rows) {
    if (!byName.has(r.INDEX_NAME)) byName.set(r.INDEX_NAME, []);
    byName.get(r.INDEX_NAME)!.push(r.COLUMN_NAME);
  }
  return [...byName.values()];
}

// Có index nào bắt đầu ĐÚNG bằng dãy cột cần (theo thứ tự) không?
// InnoDB secondary index ngầm gắn PK ở cuối, nhưng ta chỉ cần prefix filter+order.
function hasCoveringIndex(indexes: string[][], required: string[]): boolean {
  return indexes.some(
    (cols) =>
      cols.length >= required.length &&
      required.every((c, i) => cols[i] === c),
  );
}

async function main() {
  console.log('\x1b[1m═══ AUDIT INDEX (Epic 3 phần 2) — test trước ═══\x1b[0m');
  const ds = await AppDataSource.initialize();
  console.log(`Kết nối DB: ${ds.options.database}\n`);

  const patterns: Pattern[] = [
    // ─── Kỳ vọng ĐỎ (còn nợ index) ───────────────────────────────────────────
    {
      name: 'notifications.findAll (WHERE user_id ORDER BY created_at)',
      table: 'notifications',
      filter: ['user_id'],
      orderCol: 'created_at',
      explainSql: 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      params: [59022],
    },
    {
      name: 'interactions.findByProduct (reviews WHERE product_id ORDER BY created_at)',
      table: 'reviews',
      filter: ['product_id'],
      orderCol: 'created_at',
      explainSql: 'SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20',
      params: [342127],
    },
    {
      name: 'chat.getMessages (messages WHERE conversation_id ORDER BY created_at)',
      table: 'messages',
      filter: ['conversation_id'],
      orderCol: 'created_at',
      explainSql:
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20',
      params: [212080],
    },
    // ─── Đợt rà thứ hai (31/08) ──────────────────────────────────────────────
    //
    // Epic 3b chỉ audit BỐN list nặng nhất lúc đó. Bốn mẫu dưới đây cùng hình
    // dạng "WHERE khoá + ORDER BY thời gian" nhưng nằm ở bảng khác, và không ai
    // rà lại sau khi mã mới được viết thêm. Đó chính là lý do đợt rà này tồn
    // tại: sửa xong một lượt không có nghĩa là xong mãi mãi.
    {
      name: 'withdrawals.findAll (WHERE user_id ORDER BY created_at)',
      table: 'withdrawals',
      filter: ['user_id'],
      orderCol: 'created_at',
      explainSql:
        'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      params: [1],
    },
    {
      name: 'payments.findAll (WHERE user_id ORDER BY created_at)',
      table: 'payments',
      filter: ['user_id'],
      orderCol: 'created_at',
      explainSql:
        'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      params: [1],
    },
    {
      name: 'wallets: lịch sử giao dịch (WHERE wallet_id ORDER BY created_at)',
      table: 'wallet_transactions',
      filter: ['wallet_id'],
      orderCol: 'created_at',
      explainSql:
        'SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 20',
      params: [1],
    },
    {
      // Sắp theo `updated_at` chứ không `created_at`: danh sách chat xếp theo
      // lần nhắn gần nhất, không phải lần tạo hội thoại.
      name: 'chat.getMyConversations (WHERE buyer_id ORDER BY updated_at)',
      table: 'conversations',
      filter: ['buyer_id'],
      orderCol: 'updated_at',
      explainSql:
        'SELECT * FROM conversations WHERE buyer_id = ? ORDER BY updated_at DESC LIMIT 20',
      params: [1],
    },
    {
      name: 'interactions.findAll (reviews toàn bảng ORDER BY created_at) — admin',
      table: 'reviews',
      filter: [],
      orderCol: 'created_at',
      explainSql: 'SELECT * FROM reviews ORDER BY created_at DESC LIMIT 20',
      params: [],
    },
    // ─── Kỳ vọng XANH (control — chứng minh test biết phân biệt) ──────────────
    {
      name: 'orders.findAll admin (keyset ORDER BY created_at, id) — Epic 2',
      table: 'orders',
      filter: [],
      orderCol: 'created_at',
      explainSql: 'SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 20',
      params: [],
      control: true,
    },
    {
      name: 'orders.findAll user (WHERE user_id ORDER BY created_at)',
      table: 'orders',
      filter: ['user_id'],
      orderCol: 'created_at',
      explainSql: 'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      params: [3],
      control: true,
    },
  ];

  const missing: string[] = [];
  for (const p of patterns) {
    const required = [...p.filter, p.orderCol];
    const idxs = await indexPrefixes(ds, p.table);
    const covered = hasCoveringIndex(idxs, required);

    // EXPLAIN minh hoạ (không dùng để phán xét — xem chú thích đầu file).
    const explain: any[] = await ds.query(`EXPLAIN ${p.explainSql}`, p.params);
    const e = explain[0] || {};
    const diag = `type=${e.type} key=${e.key ?? '∅'} rows=${e.rows} extra="${e.Extra ?? ''}"`;

    console.log(`\x1b[1m${p.name}\x1b[0m`);
    console.log(`  cần index ghép: (${required.join(', ')})`);
    console.log(`  EXPLAIN thật:   ${diag}`);
    if (covered) {
      ok(`đã có index phủ (${required.join(', ')})${p.control ? ' [control]' : ''}`);
    } else {
      bad(
        `THIẾU index (${required.join(', ')}) → ORDER BY sẽ filesort khi khoá có nhiều dòng`,
      );
      missing.push(
        `CREATE INDEX idx_${p.table}_${required.join('_')} ON ${p.table} (${required.join(', ')});`,
      );
    }
    console.log('');
  }

  // ─── Phần 2: index 1-CỘT THỪA (prefix con của composite) — nợ dọn Epic 3 ────
  // Một index (col) là THỪA khi đã có composite (col, …): composite phủ mọi truy
  // vấn dùng leftmost prefix VÀ đỡ luôn khoá ngoại trên col, nên index 1-cột chỉ
  // tốn thêm ghi + dung lượng. Test ĐỎ khi index thừa còn đó, XANH sau khi drop.
  // CHỐT AN TOÀN: chỉ drop khi CHẮC CHẮN có composite phủ (nếu không, drop = làm
  // khoá ngoại mất index đỡ → chậm cascade/insert).
  console.log('\x1b[1m── Index 1-cột thừa (prefix con của composite) ──\x1b[0m');
  const redundants: Array<{ table: string; col: string }> = [
    { table: 'reviews', col: 'product_id' },
    { table: 'messages', col: 'conversation_id' },
    // Đợt rà 31/08 — hai cái này lọt khỏi lần dọn trước:
    //   products.idx_seller_id          ⊂ idx_seller_status (seller_id, status)
    //   order_shipments.idx_shipment_order ⊂ uq_shipment_order_seller (order_id, seller_id)
    { table: 'products', col: 'seller_id' },
    { table: 'order_shipments', col: 'order_id' },
  ];
  for (const r of redundants) {
    const idxs = await indexPrefixes(ds, r.table);
    const hasComposite = idxs.some((cols) => cols.length > 1 && cols[0] === r.col);
    const hasSingle = idxs.some((cols) => cols.length === 1 && cols[0] === r.col);
    console.log(`\x1b[1m${r.table}.(${r.col})\x1b[0m`);
    if (!hasComposite) {
      bad(
        `${r.table}: KHÔNG có composite bắt đầu bằng ${r.col} — KHÔNG được drop index 1-cột (FK mất index đỡ)`,
      );
    } else if (hasSingle) {
      bad(
        `${r.table}: index 1-cột (${r.col}) THỪA — đã có composite phủ; nên drop`,
      );
    } else {
      ok(`${r.table}: đã dọn index 1-cột (${r.col}); composite vẫn phủ FK + truy vấn`);
    }
    console.log('');
  }

  await ds.destroy();

  if (missing.length > 0) {
    console.log('\x1b[1mMigration cần để chuyển XANH (đề xuất):\x1b[0m');
    for (const s of [...new Set(missing)]) console.log(`  ${s}`);
    console.log('');
  }
  console.log(
    failures === 0
      ? '\x1b[1m\x1b[32m═══ KẾT QUẢ: TẤT CẢ PASS ✓ (index đã đủ) ═══\x1b[0m'
      : `\x1b[1m\x1b[31m═══ KẾT QUẢ: ${failures} FAIL ✗ (còn nợ index — đây là kết quả audit) ═══\x1b[0m`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\x1b[31mLỖI CHẠY AUDIT INDEX:\x1b[0m', e);
  process.exit(2);
});
