/**
 * SOI SQL: mỗi file trong `src/` sinh ra những câu lệnh nào, và câu nào chậm.
 *
 *   npm run sql:audit
 *
 * ─── Vì sao phải làm kiểu này ────────────────────────────────────────────────
 *
 * TypeORM không cho biết trước SQL nó sẽ sinh. `repo.find({ relations: [...] })`
 * có thể ra một câu JOIN, mà cũng có thể ra N+1 câu — tuỳ quan hệ, tuỳ dữ liệu.
 * Đọc mã mà đoán thì đoán sai. Nên bài này KHÔNG đọc mã: nó chạy ứng dụng thật,
 * bắn thật vào 54 route GET, và ghi lại từng câu SQL thật sự chạy.
 *
 * ─── Cái khó: gắn câu SQL về đúng dòng mã ────────────────────────────────────
 *
 * Cách hiển nhiên là trong `logQuery` gọi `new Error().stack` rồi tìm khung nào
 * thuộc `src/`. Đã thử: ra **0 khung**. Giữa lúc service gọi `.find()` và lúc
 * TypeORM gọi logger có vài lần `await`, mỗi lần `await` là một lượt quay lại
 * event loop, và stack đồng bộ bị xoá sạch ở đó.
 *
 * Nên đổi cách: vá các phương thức của `Repository` / `SelectQueryBuilder` /
 * `EntityManager` / `QueryRunner`. Lúc phương thức bị gọi, stack VẪN CÒN NGUYÊN
 * — bắt chỗ gọi ngay khoảnh khắc đó, rồi bọc phần còn lại trong
 * `AsyncLocalStorage`. ALS đi xuyên qua `await`, nên tới lúc `logQuery` chạy thì
 * vẫn đọc lại được "câu này do file nào, dòng nào gọi".
 *
 * ─── Vì sao phải có dữ liệu thật ─────────────────────────────────────────────
 *
 * `EXPLAIN` trên bảng rỗng luôn đẹp: 0 dòng thì đường nào cũng "rows=1". Phải
 * chạy `sql:audit:seed` trước để các bảng có dòng, MySQL mới phải thật sự chọn
 * đường và mới lộ ra chỗ nào quét toàn bảng, chỗ nào sắp xếp ngoài index.
 */
import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';

// ─── Cấu hình môi trường TRƯỚC khi nạp AppModule ──────────────────────────────
// AppModule đọc biến môi trường lúc nạp, nên phải đặt ở đây chứ không phải sau.
// Cũng vì thế mà bên dưới dùng `require()` chứ không `import` — `import` bị nâng
// lên đầu file, sẽ chạy trước cả những dòng này.
const E = process.env;
E.NODE_ENV ??= 'test';
E.DB_HOST ??= '127.0.0.1';
E.DB_PORT ??= '3307';
E.DB_USERNAME ??= 'root';
E.DB_PASSWORD ??= 'testpw';
E.DB_DATABASE ??= 'zoldify_sqlaudit';
E.REDIS_URL ??= 'redis://127.0.0.1:6380';
E.JWT_ACCESS_SECRET ??= 'soi-sql-access';
E.JWT_REFRESH_TOKEN_SECRET ??= 'soi-sql-refresh';
E.JWT_ACCESS_EXPIRE ??= '1d';
E.JWT_REFRESH_EXPIRE ??= '7d';
E.SITE_URL ??= 'http://localhost:3001';

const DB = E.DB_DATABASE;
if (!/audit/i.test(DB)) {
  console.error(
    `✋ Từ chối: DB_DATABASE = "${DB}" — tên phải chứa "audit".\n` +
      '   Bài soi bắn hàng trăm request vào ứng dụng thật; chỉ chạy trên DB dùng một lần.',
  );
  process.exit(1);
}

// Stack mặc định 10 khung là không đủ: giữa chỗ gọi và phương thức bị vá còn
// vài lớp của TypeORM.
Error.stackTraceLimit = 50;

// ─── Ghi nhận ────────────────────────────────────────────────────────────────

interface ChoGoi {
  site: string; // 'src/messaging/chat/chat.service.ts:212'
  api: string; // 'Repository.find'
}
const als = new AsyncLocalStorage<ChoGoi>();

interface BanGhi {
  site: string;
  api: string;
  sql: string;
  params: unknown[];
  route: string;
}
const banGhi: BanGhi[] = [];
let routeHienTai = '(khởi động)';

const BS = String.fromCharCode(92); // dấu gạch chéo ngược, viết thế này cho khỏi rối escape
const reFrame = new RegExp(
  'Zoldify_Backend[' + BS + BS + '/]((?:src|scripts)[^\\s:)]+):(\\d+):\\d+',
);

/** Chỗ gọi = khung `src/` đầu tiên trong stack, bỏ qua chính file này. */
function choGoi(): string {
  const st = (new Error().stack ?? '').split('\n');
  for (const dong of st) {
    const m = reFrame.exec(dong);
    if (!m) continue;
    const f = m[1].split(BS).join('/');
    if (f.includes('scripts/sql-audit')) continue;
    return f + ':' + m[2];
  }
  return '(ngoài src/)';
}

/**
 * Vá một phương thức: bắt chỗ gọi ngay lúc gọi, rồi chạy phần còn lại bên trong
 * ALS để `logQuery` phía sau vài lần await vẫn đọc lại được.
 *
 * Có `daVa` để không vá chồng: `EntityManager` và `Repository` dùng chung vài
 * phương thức, vá hai lần thì lớp trong ghi đè ngữ cảnh của lớp ngoài và chỗ
 * gọi bị trỏ nhầm vào chính TypeORM.
 */
const daVa = new WeakSet<object>();
function va(proto: unknown, ten: string, nhan: string): void {
  const o = proto as Record<string, unknown>;
  const goc = o[ten];
  if (typeof goc !== 'function') return;
  if (daVa.has(goc as object)) return;
  const boc = function (this: unknown, ...args: unknown[]): unknown {
    if (als.getStore()) return (goc as (...a: unknown[]) => unknown).apply(this, args);
    const ctx: ChoGoi = { site: choGoi(), api: nhan + '.' + ten };
    return als.run(ctx, () => (goc as (...a: unknown[]) => unknown).apply(this, args));
  };
  daVa.add(boc);
  o[ten] = boc;
}

function vaTypeOrm(): void {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
  const to = require('typeorm');

  const mRepo = [
    'find', 'findBy', 'findOne', 'findOneBy', 'findOneOrFail', 'findAndCount',
    'count', 'countBy', 'exists', 'existsBy', 'save', 'insert', 'update',
    'upsert', 'delete', 'remove', 'softDelete', 'restore', 'increment',
    'decrement', 'query',
  ];
  for (const m of mRepo) va(to.Repository.prototype, m, 'Repository');

  const mQb = [
    'getMany', 'getOne', 'getOneOrFail', 'getManyAndCount', 'getRawMany',
    'getRawOne', 'getCount', 'getExists', 'execute', 'stream',
  ];
  for (const m of mQb) va(to.SelectQueryBuilder.prototype, m, 'QueryBuilder');
  for (const ten of ['InsertQueryBuilder', 'UpdateQueryBuilder', 'DeleteQueryBuilder']) {
    if (to[ten]) va(to[ten].prototype, 'execute', ten);
  }

  const mEm = [
    'find', 'findOne', 'findOneBy', 'findAndCount', 'count', 'save', 'insert',
    'update', 'delete', 'remove', 'increment', 'decrement', 'query', 'transaction',
  ];
  for (const m of mEm) va(to.EntityManager.prototype, m, 'EntityManager');

  va(to.DataSource.prototype, 'query', 'DataSource');
  va(to.DataSource.prototype, 'transaction', 'DataSource');

  // QueryRunner là lớp riêng của driver, không xuất ra từ gói gốc. Nhiều
  // service gọi thẳng `queryRunner.query(...)` nên thiếu chỗ này là mất hẳn một
  // nhóm truy vấn — đáng để with-try một lần.
  try {
    const qr = require('typeorm/driver/mysql/MysqlQueryRunner');
    va(qr.MysqlQueryRunner.prototype, 'query', 'QueryRunner');
  } catch {
    console.warn('  (không vá được MysqlQueryRunner — truy vấn gọi thẳng qua nó sẽ không có chỗ gọi)');
  }
  /* eslint-enable */
}

/** Logger của TypeORM. Được gọi cho MỌI truy vấn, không phụ thuộc cờ `logging`. */
class BoGhi {
  logQuery(sql: string, params?: unknown[]): void {
    const s = als.getStore();
    banGhi.push({
      site: s ? s.site : '(ngoài src/)',
      api: s ? s.api : '-',
      sql: sql.trim(),
      params: params ?? [],
      route: routeHienTai,
    });
  }
  logQueryError(): void {}
  logQuerySlowQuery(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

// ─── Bắn request ─────────────────────────────────────────────────────────────

const BO_QUA = [
  // Ba nhóm này gọi ra dịch vụ ngoài (GHN, PayOS). Bắn vào chúng là bắn vào
  // máy chủ người khác, và câu trả lời phụ thuộc mạng chứ không phụ thuộc DB —
  // đúng thứ bài soi này không quan tâm.
  '/api/v1/ghn/',
  '/api/v1/payos/refresh/',
  '/api/v1/payos/status/',
];

interface Tokens { buyer: string; seller: string; admin: string }

async function dangNhap(base: string, email: string): Promise<string> {
  const r = await fetch(base + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: '123456' }),
  });
  const j = (await r.json()) as { data?: { access_token?: string } };
  const t = j.data?.access_token;
  if (!t) throw new Error(`Không đăng nhập được ${email}: HTTP ${r.status}`);
  return t;
}

/** Giá trị thật cho các tham số đường dẫn — lấy từ chính DB soi. */
async function layThamSo(pool: mysql.Pool): Promise<Record<string, string>> {
  const mot = async (sql: string): Promise<string> => {
    const [r] = await pool.query<mysql.RowDataPacket[]>(sql);
    return r.length ? String(Object.values(r[0])[0]) : '1';
  };
  return {
    productId: await mot('SELECT id FROM products ORDER BY id LIMIT 1'),
    categoryId: await mot('SELECT id FROM categories ORDER BY id LIMIT 1'),
    categorySlug: await mot('SELECT slug FROM categories ORDER BY id LIMIT 1'),
    orderId: await mot('SELECT id FROM orders ORDER BY id LIMIT 1'),
    userId: await mot("SELECT id FROM users WHERE role='seller' ORDER BY id LIMIT 1"),
    sellerId: await mot("SELECT id FROM users WHERE role='seller' ORDER BY id LIMIT 1"),
    notificationId: await mot('SELECT id FROM notifications ORDER BY id LIMIT 1'),
    paymentId: await mot('SELECT id FROM payments ORDER BY id LIMIT 1'),
    addressId: await mot('SELECT id FROM addresses ORDER BY id LIMIT 1'),
    conversationId: await mot('SELECT id FROM conversations ORDER BY id LIMIT 1'),
    reviewId: await mot('SELECT id FROM reviews ORDER BY id LIMIT 1'),
    escrowOrderId: await mot('SELECT order_id FROM escrows ORDER BY id LIMIT 1'),
  };
}

/** Thay `{id}` bằng giá trị thật, chọn theo đường dẫn chứ không chỉ theo tên. */
function dienThamSo(p: string, v: Record<string, string>): string {
  return p.replace(/\{(\w+)\}/g, (_m, ten: string) => {
    if (ten === 'slug') return v.categorySlug;
    if (ten === 'sellerId' || ten === 'userId') return v.sellerId;
    if (ten === 'productId') return v.productId;
    if (ten === 'orderId') return p.includes('/escrows/') ? v.escrowOrderId : v.orderId;
    if (p.startsWith('/api/v1/products/')) return v.productId;
    if (p.startsWith('/api/v1/categories/')) return v.categoryId;
    if (p.startsWith('/api/v1/orders/')) return v.orderId;
    if (p.startsWith('/api/v1/notifications/')) return v.notificationId;
    if (p.startsWith('/api/v1/payments/')) return v.paymentId;
    if (p.startsWith('/api/v1/addresses/')) return v.addressId;
    if (p.startsWith('/api/v1/chat/')) return v.conversationId;
    if (p.startsWith('/api/v1/interactions/')) return v.reviewId;
    if (p.startsWith('/api/v1/users/') || p.startsWith('/api/v1/admin/users/')) return v.userId;
    return '1';
  });
}

// ─── Phân tích ───────────────────────────────────────────────────────────────

type Muc = 'CAO' | 'VỪA' | 'THẤP' | '';

interface Ket {
  site: string;
  api: string;
  sql: string;
  params: unknown[];
  soLan: number; // tổng số lần chạy trong cả bài
  lapToiDa: number; // số lần lặp NHIỀU NHẤT trong MỘT request → dấu hiệu N+1
  routes: Set<string>;
  explain?: { type: string; key: string; rows: number; extra: string };
  msTrungVi?: number; // thời gian chạy thật, trung vị 3 lần
  canhBao: string[];
  muc: Muc;
}

function phanTich(): Ket[] {
  const map = new Map<string, Ket>();
  // Đếm lặp trong PHẠM VI MỘT REQUEST. Một câu chạy 200 lần rải đều 200 request
  // là bình thường; chạy 200 lần trong MỘT request mới là N+1.
  const trongRequest = new Map<string, Map<string, number>>();

  for (const b of banGhi) {
    const khoa = b.site + ' ' + b.sql;
    let k = map.get(khoa);
    if (!k) {
      k = {
        site: b.site, api: b.api, sql: b.sql, params: b.params,
        soLan: 0, lapToiDa: 0, routes: new Set(), canhBao: [], muc: '',
      };
      map.set(khoa, k);
    }
    k.soLan++;
    k.routes.add(b.route);

    let perR = trongRequest.get(b.route);
    if (!perR) { perR = new Map(); trongRequest.set(b.route, perR); }
    perR.set(khoa, (perR.get(khoa) ?? 0) + 1);
  }
  for (const perR of trongRequest.values()) {
    for (const [khoa, n] of perR) {
      const k = map.get(khoa);
      if (k && n > k.lapToiDa) k.lapToiDa = n;
    }
  }
  return [...map.values()];
}

const laCount = (sql: string): boolean => /^\s*SELECT\s+COUNT\s*\(/i.test(sql);
// TypeORM khi `find` có quan hệ + phân trang thì KHÔNG dùng LIMIT thẳng: nó
// dựng một bảng dẫn xuất rồi DISTINCT lên đó để lấy id trang hiện tại. Đây là
// một hình dạng riêng, cần gọi đúng tên chứ không gộp chung với "quét bảng".
const laDistinctAlias = (sql: string): boolean => sql.includes('distinctAlias');

async function chayExplain(pool: mysql.Pool, ket: Ket[]): Promise<void> {
  for (const k of ket) {
    if (!/^\s*SELECT/i.test(k.sql)) continue;
    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'EXPLAIN ' + k.sql,
        k.params,
      );
      if (rows.length) {
        // Câu có JOIN cho nhiều dòng EXPLAIN; lấy dòng tệ nhất (quét nhiều nhất).
        const xau = rows.reduce((a, b) => (Number(b.rows ?? 0) > Number(a.rows ?? 0) ? b : a));
        k.explain = {
          type: String(xau.type ?? '?'),
          key: xau.key === null || xau.key === undefined ? '∅' : String(xau.key),
          rows: Number(xau.rows ?? 0),
          extra: String(xau.Extra ?? ''),
        };
      }
      // Đo thời gian THẬT. `EXPLAIN` chỉ nói MySQL định làm gì; nó không nói
      // việc đó tốn bao lâu. Ba lần lấy trung vị để một lần lỡ nhịp không làm
      // lệch kết quả — lần đầu thường chậm hơn vì buffer pool còn nguội.
      const t: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = process.hrtime.bigint();
        await pool.query(k.sql, k.params);
        t.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      t.sort((a, b) => a - b);
      k.msTrungVi = Math.round(t[1] * 100) / 100;
    } catch {
      /* Câu lạ hoặc thiếu tham số — bỏ qua, vẫn giữ SQL trong báo cáo. */
    }
  }

  for (const k of ket) {
    const e = k.explain;
    if (e) {
      const quetHet = e.type === 'ALL' || e.key === '∅';
      if (quetHet && e.rows >= 200) {
        if (laCount(k.sql)) {
          // Đây KHÔNG phải lỗi thiếu index: đếm toàn bộ một bảng thì bắt buộc
          // phải duyệt hết. Nhưng nó vẫn là chi phí thật, và nó lặp lại ở MỌI
          // trang của MỌI danh sách — nên vẫn phải nêu, chỉ là nêu đúng tên.
          k.canhBao.push(`đếm cả bảng ${e.rows} dòng cho phân trang`);
        } else if (laDistinctAlias(k.sql)) {
          k.canhBao.push(`TypeORM dựng bảng dẫn xuất rồi DISTINCT trên ${e.rows} dòng`);
        } else {
          k.canhBao.push(`quét toàn bảng ${e.rows} dòng, không dùng index`);
        }
      }
      // Ngưỡng 50: sắp xếp 3 dòng ngoài index thì MySQL làm xong trước khi kịp
      // đo. Báo mọi filesort là biến báo cáo thành danh sách 200 dòng nhiễu,
      // rồi không ai đọc nữa.
      if (e.rows >= 50 && e.extra.includes('Using filesort'))
        k.canhBao.push('sắp xếp ngoài index (filesort)');
      if (e.rows >= 50 && e.extra.includes('Using temporary'))
        k.canhBao.push('phải dựng bảng tạm');
    }
    if (k.lapToiDa >= 5)
      k.canhBao.push(`chạy ${k.lapToiDa} lần trong MỘT request (dấu hiệu N+1)`);
    if ((k.msTrungVi ?? 0) >= 50) k.canhBao.push(`chạy mất ${k.msTrungVi}ms`);

    // Xếp mức để bạn biết đọc cái nào trước. Tiêu chí là "đau tới đâu khi dữ
    // liệu lớn lên", không phải "trông lạ tới đâu".
    const r = e?.rows ?? 0;
    if (k.lapToiDa >= 5 || (k.msTrungVi ?? 0) >= 50 || (r >= 1000 && !laCount(k.sql)))
      k.muc = 'CAO';
    else if (k.canhBao.length && r >= 200) k.muc = 'VỪA';
    else if (k.canhBao.length) k.muc = 'THẤP';
  }
}

// ─── Xuất báo cáo ────────────────────────────────────────────────────────────

function catSql(sql: string, dai = 900): string {
  const s = sql.replace(/\s+/g, ' ').trim();
  return s.length > dai ? s.slice(0, dai) + ' …(cắt bớt)' : s;
}

function xuatMarkdown(
  ket: Ket[],
  soRoute: number,
  mo: string[],
  soDong: Array<{ t: string; n: number }>,
): string {
  const theoFile = new Map<string, Ket[]>();
  for (const k of ket) {
    const f = k.site.split(':')[0];
    if (!theoFile.has(f)) theoFile.set(f, []);
    theoFile.get(f)!.push(k);
  }

  const thuTuMuc: Record<string, number> = { CAO: 0, VỪA: 1, THẤP: 2, '': 3 };
  const coCanhBao = ket.filter((k) => k.canhBao.length > 0)
    .sort((a, b) =>
      thuTuMuc[a.muc] - thuTuMuc[b.muc] ||
      (b.msTrungVi ?? 0) - (a.msTrungVi ?? 0) ||
      (b.explain?.rows ?? 0) - (a.explain?.rows ?? 0));
  const demMuc = (m: Muc): number => ket.filter((k) => k.muc === m).length;

  const L: string[] = [];
  L.push('# Soi SQL — mỗi file sinh ra câu lệnh gì');
  L.push('');
  L.push(`> Sinh tự động bằng \`npm run sql:audit\` lúc ${new Date().toISOString()}.`);
  L.push('> **Đừng sửa tay file này** — chạy lại lệnh trên là nó ghi đè.');
  L.push('');
  L.push('## Cách lấy được số liệu này');
  L.push('');
  L.push('Không đọc mã để đoán. Ứng dụng được dựng thật, nối vào một database có');
  L.push('dữ liệu thật, rồi bắn vào từng route GET. Mỗi câu SQL thực sự chạy đều');
  L.push('được ghi lại kèm **file và dòng đã gọi nó**, sau đó `EXPLAIN` từng câu.');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Route đã bắn | ${soRoute} |`);
  L.push(`| Câu SQL chạy thật | ${banGhi.length} |`);
  L.push(`| Câu SQL khác nhau | ${ket.length} |`);
  L.push(`| File \`src/\` có sinh SQL | ${[...theoFile.keys()].filter((f) => f.startsWith('src/')).length} |`);
  L.push(`| Cần xem: **cao** / vừa / thấp | **${demMuc('CAO')}** / ${demMuc('VỪA')} / ${demMuc('THẤP')} |`);
  L.push('');
  L.push('Số dòng trong DB soi lúc đo — vì `EXPLAIN` trên bảng rỗng thì câu nào');
  L.push('cũng đẹp, con số dưới đây mới là thứ làm cho kết quả có nghĩa:');
  L.push('');
  L.push('| bảng | dòng | | bảng | dòng |');
  L.push('|---|---:|---|---|---:|');
  const nua = Math.ceil(soDong.length / 2);
  for (let i = 0; i < nua; i++) {
    const a = soDong[i];
    const b = soDong[i + nua];
    L.push(`| ${a.t} | ${a.n.toLocaleString('vi-VN')} | | ${b ? b.t : ''} | ${b ? b.n.toLocaleString('vi-VN') : ''} |`);
  }
  L.push('');

  L.push('## Đọc bảng thế nào');
  L.push('');
  L.push('| Cột | Nghĩa | Xấu khi |');
  L.push('|---|---|---|');
  L.push('| `type` | cách MySQL tìm dòng | `ALL` = đọc từng dòng cả bảng |');
  L.push('| `key` | index nó thật sự dùng | `∅` = không dùng index nào |');
  L.push('| `rows` | số dòng nó ước phải đọc | càng lớn càng chậm |');
  L.push('| `Extra` | việc làm thêm | `Using filesort`, `Using temporary` |');
  L.push('| `ms` | thời gian chạy thật, trung vị 3 lần | đây mới là thứ người dùng chịu |');
  L.push('');
  L.push('Ba mức: **CAO** = lặp trong một request, hoặc ≥50ms, hoặc quét ≥1.000 dòng.');
  L.push('**VỪA** = có vấn đề và chạm ≥200 dòng. **THẤP** = có dấu hiệu nhưng dữ liệu');
  L.push('còn nhỏ nên chưa đau — ghi lại để sau này lớn lên còn biết chỗ mà tìm.');
  L.push('');
  L.push('Hai nhãn dưới đây **không phải là lỗi thiếu index**, nêu ra vì chúng vẫn tốn:');
  L.push('');
  L.push('- *đếm cả bảng N dòng cho phân trang* — `findAndCount` luôn kèm một');
  L.push('  `SELECT COUNT(*)`; đếm hết bảng thì bắt buộc phải duyệt hết. Muốn rẻ thì');
  L.push('  phải đổi cách phân trang (keyset), không phải thêm index.');
  L.push('- *TypeORM dựng bảng dẫn xuất rồi DISTINCT* — khi `find` có quan hệ kèm');
  L.push('  phân trang, TypeORM tách làm hai bước: lấy id của trang trước, rồi mới');
  L.push('  nạp dữ liệu. Bước lấy id chạy trên bảng dẫn xuất nên không dùng được index.');
  L.push('');

  if (coCanhBao.length) {
    L.push('## Những chỗ đáng xem trước');
    L.push('');
    L.push('| Mức | Chỗ gọi | Vấn đề | EXPLAIN | ms |');
    L.push('|---|---|---|---|---:|');
    for (const k of coCanhBao) {
      const e = k.explain;
      const ex = e ? `\`${e.type}\` · key=\`${e.key}\` · rows=${e.rows}` : '—';
      const ms = k.msTrungVi === undefined ? '—' : String(k.msTrungVi);
      L.push(`| ${k.muc} | \`${k.site}\` | ${k.canhBao.join('; ')} | ${ex} | ${ms} |`);
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('## Chi tiết theo từng file');
  L.push('');

  const ten = [...theoFile.keys()].sort((a, b) => {
    const A = a.startsWith('src/') ? 0 : 1, B = b.startsWith('src/') ? 0 : 1;
    return A - B || a.localeCompare(b);
  });

  for (const f of ten) {
    const ds = theoFile.get(f)!.sort((a, b) => {
      const la = Number(a.site.split(':')[1] ?? 0), lb = Number(b.site.split(':')[1] ?? 0);
      return la - lb;
    });
    const cao = ds.filter((k) => k.muc === 'CAO').length;
    const vua = ds.filter((k) => k.muc === 'VỪA').length;
    L.push(`### \`${f}\``);
    L.push('');
    L.push(`${ds.length} câu SQL khác nhau · ${ds.reduce((s, k) => s + k.soLan, 0)} lượt chạy` +
      (cao ? ` · **${cao} mức CAO**` : '') + (vua ? ` · ${vua} mức VỪA` : ''));
    L.push('');
    for (const k of ds) {
      const dong = k.site.split(':')[1] ?? '?';
      L.push(`<details><summary><b>dòng ${dong}</b> — <code>${k.api}</code>` +
        (k.muc ? ` — <b>[${k.muc}]</b> ${k.canhBao.join('; ')}` : '') +
        ` <i>(${k.soLan} lượt${k.msTrungVi === undefined ? '' : ', ' + k.msTrungVi + 'ms'})</i></summary>`);
      L.push('');
      L.push('```sql');
      L.push(catSql(k.sql));
      L.push('```');
      L.push('');
      if (k.explain) {
        L.push(`EXPLAIN: \`type=${k.explain.type}\` · \`key=${k.explain.key}\` · ` +
          `\`rows=${k.explain.rows}\`` + (k.explain.extra ? ` · \`${k.explain.extra}\`` : '') +
          (k.msTrungVi === undefined ? '' : ` · chạy thật **${k.msTrungVi}ms**`));
        L.push('');
      }
      L.push(`Route gọi tới: ${[...k.routes].slice(0, 6).map((r) => '`' + r + '`').join(', ')}` +
        (k.routes.size > 6 ? ` …(+${k.routes.size - 6})` : ''));
      L.push('');
      L.push('</details>');
      L.push('');
    }
  }

  if (mo.length) {
    L.push('---');
    L.push('');
    L.push('## Chưa phủ được');
    L.push('');
    L.push('Những route trả về lỗi nên không sinh (hoặc sinh thiếu) truy vấn. Muốn');
    L.push('phủ nốt thì phải đổ thêm dữ liệu cho đúng vai, hoặc bắn cả route POST.');
    L.push('');
    for (const m of mo) L.push(`- ${m}`);
    L.push('');
  }
  return L.join('\n');
}

// ─── Chạy ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('▶ Vá TypeORM để bắt chỗ gọi…');
  vaTypeOrm();

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../src/app.module');
  const { configureRouting } = require('../src/core/routing.config');
  const { TransformInterceptor } = require('../src/core/transform.interceptor');
  const { HttpExceptionFilter } = require('../src/core/http-exception.filter');
  const { Reflector } = require('@nestjs/core');

  console.log('▶ Dựng ứng dụng…');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  configureRouting(app);
  await app.listen(0);
  const cong = (app.getHttpServer().address() as { port: number }).port;
  const base = 'http://127.0.0.1:' + cong;
  console.log(`  ứng dụng đang chạy ở ${base}`);

  // Gắn bộ ghi SAU khi dựng xong: các truy vấn lúc khởi động không thuộc file
  // nghiệp vụ nào, đưa vào chỉ làm nhiễu báo cáo.
  const ds = app.get(DataSource);
  ds.logger = new BoGhi();
  /* eslint-enable */

  const pool = mysql.createPool({
    host: E.DB_HOST, port: Number(E.DB_PORT), user: E.DB_USERNAME,
    password: E.DB_PASSWORD, database: DB, connectionLimit: 3,
  });

  console.log('▶ Đăng nhập 3 vai…');
  const tk: Tokens = {
    buyer: await dangNhap(base, 'buyer@zoldify.com'),
    seller: await dangNhap(base, 'seller@zoldify.com'),
    admin: await dangNhap(base, 'admin@zoldify.com'),
  };

  const thamSo = await layThamSo(pool);

  const openapi = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'openapi.json'), 'utf8'),
  ) as { paths: Record<string, Record<string, unknown>> };
  const routes = Object.keys(openapi.paths)
    .filter((p) => openapi.paths[p].get)
    .filter((p) => !BO_QUA.some((b) => p.startsWith(b)));

  console.log(`▶ Bắn ${routes.length} route GET (mỗi route thử lần lượt 3 vai cho tới khi qua)…`);
  const mo: string[] = [];
  let daBan = 0;

  for (const r of routes) {
    const duong = dienThamSo(r, thamSo);
    let ok = false;
    let cuoi = 0;
    for (const [vai, token] of [['buyer', tk.buyer], ['seller', tk.seller], ['admin', tk.admin]] as const) {
      routeHienTai = `GET ${r} [${vai}]`;
      // Throttler: 10 request/giây. Đi chậm hơn ngưỡng thay vì phải xử 429 —
      // một request bị chặn là một request không sinh SQL, tức là mất dữ liệu.
      await new Promise((s) => setTimeout(s, 130));
      let res: Response;
      try {
        res = await fetch(base + duong, { headers: { Authorization: 'Bearer ' + token } });
      } catch {
        continue;
      }
      daBan++;
      cuoi = res.status;
      await res.text();
      if (res.status < 400) { ok = true; break; }
    }
    if (!ok) mo.push(`\`GET ${r}\` — mọi vai đều trả HTTP ${cuoi}`);
  }
  routeHienTai = '(sau khi bắn)';

  console.log(`  đã bắn ${daBan} request · ghi được ${banGhi.length} câu SQL`);

  console.log('▶ Chạy EXPLAIN…');
  const ket = phanTich();
  await chayExplain(pool, ket);

  // Số dòng thật lúc đo. Phải `ANALYZE` trước: `information_schema.table_rows`
  // là ước lượng cũ, vừa chèn 3.600 tin nhắn xong mà không ANALYZE thì nó vẫn
  // báo con số của lần thống kê trước — báo cáo sẽ nói dối về chính dữ liệu nó
  // vừa đo trên đó.
  const [bang] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [DB],
  );
  for (const b of bang) {
    await pool.query('ANALYZE TABLE `' + String(b.t) + '`');
  }
  const [dong] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT table_name AS t, table_rows AS n FROM information_schema.tables' +
      " WHERE table_schema = ? AND table_rows > 0 AND table_name <> 'migrations'" +
      ' ORDER BY table_rows DESC',
    [DB],
  );
  const soDong = dong.map((r) => ({ t: String(r.t), n: Number(r.n) }));

  const md = xuatMarkdown(ket, routes.length, mo, soDong);
  const dich = path.join(__dirname, '..', 'docs', 'system-design', 'sql-audit.md');
  fs.writeFileSync(dich, md, 'utf8');
  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'system-design', 'sql-audit.json'),
    JSON.stringify(
      ket.map((k) => ({ ...k, routes: [...k.routes] })),
      null,
      2,
    ),
    'utf8',
  );

  const canhBao = ket.filter((k) => k.canhBao.length).length;
  console.log(`\n✓ Đã ghi docs/system-design/sql-audit.md`);
  console.log(`  ${ket.length} câu SQL khác nhau · ${canhBao} chỗ bị đánh dấu cần xem`);

  await pool.end();
  await app.close();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
