/**
 * BỘ TỰ KIỂM (self-check) — bằng chứng độc lập cho Epic 0/1/2.
 *
 * Mục tiêu: KHÔNG tin lời ai, chỉ tin số. Chạy file này in ra PASS/FAIL rõ ràng
 * trên đúng dữ liệu 1M thật. Không sửa dữ liệu (chỉ đọc). Không cần bật server.
 *
 * Chạy:
 *   node -r ts-node/register -r tsconfig-paths/register scripts/selfcheck.ts
 *
 * Thoát mã 0 nếu TẤT CẢ pass, mã 1 nếu có bất kỳ FAIL nào (tiện cắm vào CI).
 *
 * Ba phép thử quyết định:
 *   Epic 0  — dữ liệu sạch: 0 bản ghi mồ côi trên MỌI khoá ngoại + ledger cân (SUM=0).
 *   Epic 1  — chặn limit: xác nhận helper normalizePagination cắt size về [1,100].
 *   Epic 2  — keyset đi không sót/không trùng: đi các trang bằng con trỏ, so với OFFSET.
 */
import AppDataSource from '../src/data-source';
import { normalizePagination } from '../src/common/dto/pagination.dto';

let failures = 0;
const ok = (msg: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${msg}`);
};
const head = (msg: string) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

async function epic0(ds: typeof AppDataSource) {
  head('EPIC 0 — Dữ liệu sạch (mồ côi = 0, ledger cân)');

  // (a) Tự khám phá MỌI khoá ngoại từ chính schema — không liệt kê tay, không sót.
  const fks: Array<{
    TABLE_NAME: string;
    COLUMN_NAME: string;
    REFERENCED_TABLE_NAME: string;
    REFERENCED_COLUMN_NAME: string;
  }> = await ds.query(
    `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, COLUMN_NAME`,
  );
  console.log(`  (kiểm ${fks.length} quan hệ khoá ngoại do MySQL tự khai)`);

  let orphanTotal = 0;
  for (const fk of fks) {
    // Mồ côi = con trỏ tới cha KHÔNG tồn tại (FK khác NULL nhưng không khớp PK cha).
    // Cha bị soft-delete VẪN còn dòng nên LEFT JOIN vẫn khớp → không tính là mồ côi.
    const rows: Array<{ n: number }> = await ds.query(
      `SELECT COUNT(*) AS n
         FROM \`${fk.TABLE_NAME}\` c
         LEFT JOIN \`${fk.REFERENCED_TABLE_NAME}\` p
                ON c.\`${fk.COLUMN_NAME}\` = p.\`${fk.REFERENCED_COLUMN_NAME}\`
        WHERE c.\`${fk.COLUMN_NAME}\` IS NOT NULL AND p.\`${fk.REFERENCED_COLUMN_NAME}\` IS NULL`,
    );
    const n = Number(rows[0].n);
    orphanTotal += n;
    const label = `${fk.TABLE_NAME}.${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`;
    if (n > 0) bad(`${label}: ${n} mồ côi`);
  }
  if (orphanTotal === 0) ok(`0 mồ côi trên toàn bộ ${fks.length} khoá ngoại`);

  // (b) Ledger cân theo bút toán kép: tổng toàn hệ = 0 VÀ mỗi giao dịch = 0.
  const g: Array<{ s: string | null }> = await ds.query(
    `SELECT COALESCE(SUM(amount),0) AS s FROM ledger_entries`,
  );
  const globalSum = Number(g[0].s);
  globalSum === 0
    ? ok(`ledger toàn hệ cân: SUM(amount) = 0`)
    : bad(`ledger toàn hệ LỆCH: SUM(amount) = ${globalSum}`);

  const perTx: Array<{ bad_tx: number }> = await ds.query(
    `SELECT COUNT(*) AS bad_tx FROM (
        SELECT transaction_id FROM ledger_entries
        GROUP BY transaction_id HAVING SUM(amount) <> 0
     ) t`,
  );
  Number(perTx[0].bad_tx) === 0
    ? ok(`mọi giao dịch ledger đều cân (0 giao dịch lệch)`)
    : bad(`${perTx[0].bad_tx} giao dịch ledger có SUM(amount) ≠ 0`);

  // (c) Quy mô đạt yêu cầu đề bài (≥ 500k/feature, ~1M orders).
  const scale: Array<{ orders: number; items: number; users: number }> = await ds.query(
    `SELECT
       (SELECT COUNT(*) FROM orders)      AS orders,
       (SELECT COUNT(*) FROM order_items) AS items,
       (SELECT COUNT(*) FROM users)       AS users`,
  );
  const s = scale[0];
  console.log(`  (quy mô: orders=${s.orders}, order_items=${s.items}, users=${s.users})`);
  Number(s.orders) >= 500000
    ? ok(`quy mô orders ≥ 500k (đạt ${Number(s.orders).toLocaleString()})`)
    : bad(`quy mô orders < 500k (chỉ ${s.orders})`);
}

function epic1() {
  head('EPIC 1/3 — Chặn limit (helper normalizePagination, kiểm logic thuần)');
  // Đây là chốt duy nhất mọi list endpoint đi qua. Kiểm thẳng hàm, không cần server.
  const cases: Array<[string, string | undefined, number]> = [
    ['limit=1000000', '1000000', 100], // lạm dụng → cắt về trần 100
    ['limit=0', '0', 10], //            ≤0 KHÔNG phải limit hợp lệ → mặc định 10 (theo docstring)
    ['limit=-5', '-5', 10], //          số âm → mặc định 10 (an toàn: vẫn ∈[1,100])
    ['limit=abc', 'abc', 10], //        rác → mặc định 10
    ['limit=undefined', undefined, 10], // thiếu → mặc định 10
    ['limit=50', '50', 50], //          hợp lệ → giữ nguyên
  ];
  for (const [name, input, expect] of cases) {
    const { size } = normalizePagination('1', input);
    size === expect
      ? ok(`${name} → size=${size}`)
      : bad(`${name} → size=${size} (kỳ vọng ${expect})`);
  }
  // page phải luôn ≥ 1 (offset không bao giờ âm)
  const neg = normalizePagination('-3', '20');
  neg.page >= 1 && neg.offset >= 0
    ? ok(`currentPage=-3 → page=${neg.page}, offset=${neg.offset} (không âm)`)
    : bad(`currentPage=-3 → page=${neg.page}, offset=${neg.offset}`);
}

async function epic2(ds: typeof AppDataSource) {
  head('EPIC 2 — Keyset đi KHÔNG SÓT / KHÔNG TRÙNG (so với OFFSET trên dữ liệu thật)');

  const PAGE = 100;
  const PAGES = 25; // đi 25 trang đầu = 2500 đơn mới nhất

  // (a) BASELINE bằng OFFSET — thứ tự "sự thật" mà API cũ trả.
  const offsetIds: number[] = [];
  for (let p = 0; p < PAGES; p++) {
    const rows: Array<{ id: number }> = await ds.query(
      `SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [PAGE, p * PAGE],
    );
    for (const r of rows) offsetIds.push(Number(r.id));
  }

  // (b) KEYSET — mô phỏng CHÍNH XÁC vị ngữ con trỏ mà orders.service dùng:
  //     (created_at < :cts OR (created_at = :cts AND id < :cid))
  //     con trỏ mang đủ micro-giây qua DATE_FORMAT('%f').
  const keysetIds: number[] = [];
  let cursorTs: string | null = null;
  let cursorId: number | null = null;
  for (let p = 0; p < PAGES; p++) {
    let rows: Array<{ id: number; cts: string }>;
    const sel = `SELECT id, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS cts FROM orders`;
    if (cursorTs === null) {
      rows = await ds.query(`${sel} ORDER BY created_at DESC, id DESC LIMIT ?`, [PAGE]);
    } else {
      rows = await ds.query(
        `${sel} WHERE (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        [cursorTs, cursorTs, cursorId, PAGE],
      );
    }
    for (const r of rows) keysetIds.push(Number(r.id));
    if (rows.length > 0) {
      cursorTs = rows[rows.length - 1].cts;
      cursorId = Number(rows[rows.length - 1].id);
    }
  }

  // (c) So khớp: keyset PHẢI trùng khít offset, cùng thứ tự.
  const sameLength = keysetIds.length === offsetIds.length;
  const sameOrder = sameLength && keysetIds.every((v, i) => v === offsetIds[i]);
  sameOrder
    ? ok(`${keysetIds.length} đơn: keyset TRÙNG KHÍT offset (đúng thứ tự)`)
    : bad(`keyset lệch offset (keyset=${keysetIds.length}, offset=${offsetIds.length})`);

  // (d) Không trùng lặp trong đường đi keyset.
  const dupCount = keysetIds.length - new Set(keysetIds).size;
  dupCount === 0
    ? ok(`0 bản ghi bị lặp giữa các trang keyset`)
    : bad(`${dupCount} bản ghi bị LẶP giữa các trang keyset`);

  // (e) Chốt micro-giây: có đơn nào trùng created_at tới từng giây không? Nếu có,
  //     đó chính là ranh giới dễ bỏ sót nếu con trỏ chỉ giữ mili-giây. Kiểm keyset
  //     đi qua cụm trùng đó không mất dòng nào.
  const ties: Array<{ cts: string; n: number }> = await ds.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS cts, COUNT(*) AS n
       FROM orders GROUP BY cts HAVING n > 1 ORDER BY n DESC LIMIT 1`,
  );
  if (ties.length === 0) {
    console.log(`  (không có cụm created_at trùng-giây để kiểm ranh giới — bỏ qua (e))`);
  } else {
    const tie = ties[0];
    const expected = Number(tie.n);
    // Đếm trong DB cụm này có bao nhiêu đơn, rồi đi keyset xuyên qua đúng cụm đó.
    const inCluster: Array<{ id: number; cts: string }> = await ds.query(
      `SELECT id, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS cts
         FROM orders
        WHERE DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') = ?
        ORDER BY created_at DESC, id DESC`,
      [tie.cts],
    );
    // Bắt đầu con trỏ ngay TRƯỚC dòng đầu cụm, đi tiếp và thu đúng số dòng của cụm.
    const first = inCluster[0];
    const walked: number[] = [];
    let cts: string = first.cts;
    let cid = Number(first.id) + 1; // để dòng đầu cụm cũng lọt vào (id < cid)
    // đảm bảo bao trọn: dùng created_at = cts, id < cid cho dòng đầu
    let guard = 0;
    while (guard++ < 1000) {
      const rows: Array<{ id: number; cts: string }> = await ds.query(
        `SELECT id, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f') AS cts
           FROM orders
          WHERE (created_at < ? OR (created_at = ? AND id < ?))
            AND DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') = ?
          ORDER BY created_at DESC, id DESC LIMIT 10`,
        [cts, cts, cid, tie.cts],
      );
      if (rows.length === 0) break;
      for (const r of rows) walked.push(Number(r.id));
      cts = rows[rows.length - 1].cts;
      cid = Number(rows[rows.length - 1].id);
    }
    walked.length === expected
      ? ok(`ranh giới trùng-giây (${tie.cts}): đi keyset lấy đủ ${expected}/${expected} đơn (không sót µs)`)
      : bad(`ranh giới trùng-giây (${tie.cts}): keyset lấy ${walked.length}/${expected} — BỎ SÓT`);
  }
}

async function main() {
  console.log('\x1b[1m═══ BỘ TỰ KIỂM ZOLDIFY — Epic 0/1/2 ═══\x1b[0m');
  const ds = await AppDataSource.initialize();
  console.log(`Kết nối DB: ${ds.options.database} @ ${(ds.options as any).host}`);
  try {
    await epic0(ds);
    epic1();
    await epic2(ds);
  } finally {
    await ds.destroy();
  }
  head(failures === 0 ? '\x1b[32m═══ KẾT QUẢ: TẤT CẢ PASS ✓ ═══\x1b[0m' : `\x1b[31m═══ KẾT QUẢ: ${failures} FAIL ✗ ═══\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\x1b[31mLỖI CHẠY SELF-CHECK:\x1b[0m', e);
  process.exit(2);
});
