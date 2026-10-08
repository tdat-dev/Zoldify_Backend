/**
 * NGHIỆM THU — một lệnh, một file kết quả do MÁY ghi.
 *
 * Chạy:
 *   npm run nghiem-thu
 *
 * VÌ SAO CÓ FILE NÀY.
 *
 * Sáu vòng giao việc cho một agent khác, cả sáu lần đều hỏng ở cùng một chỗ:
 * agent chạy lệnh trong cây làm việc chưa commit, rồi viết báo cáo theo Ý ĐỊNH
 * chứ không theo MÃ THOÁT. Có vòng đánh ✅ cho `openapi:check` trong khi cổng
 * đó EXIT 1; có vòng ghi "lint 910/910" trong khi số thật là 934 và mốc là 910;
 * có vòng ghi "243 test, 8/8 suite xanh" trong khi tiến trình jest bị giết giữa
 * chừng nên không in nổi dòng tổng kết — và repo có 36 file spec, không phải 8.
 *
 * Không quy trình nào chữa được chuyện đó, vì chỗ vỡ nằm ở khâu TỰ THUẬT LẠI.
 * Thứ chữa được chỉ có một: **kết quả nghiệm thu do máy ghi ra file**, người
 * làm không phải là người viết nó.
 *
 * Nên luật giao nộp từ nay gọn lại thành một câu:
 *
 *     Sản phẩm giao là `nghiem-thu.md`, không phải văn xuôi.
 *
 * File đó có SHA của HEAD và thời điểm chạy, nên một bản chép tay hoặc một bản
 * cũ đều lộ ngay khi đối chiếu với `git log`.
 *
 * BA TRẠNG THÁI, KHÔNG PHẢI HAI.
 *
 * `npm run check` sẵn có chỉ biết PASS/FAIL. Nhưng phần lớn cổng ở đây cần
 * MySQL hoặc Redis, và trên máy chưa bật Docker thì chúng đỏ vì lý do chẳng
 * liên quan gì tới mã. Đỏ kiểu đó lặp vài lần là người ta quen bỏ qua, và lúc
 * đỏ thật thì không ai nhìn nữa.
 *
 * Nên ở đây có BỎ QUA tách khỏi HỎNG, kèm lý do. Và vì "bỏ qua" không phải là
 * "đạt", chỉ khi TẤT CẢ cổng PASS thì mã thoát mới là 0.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const B = '\x1b[1m';
const G = '\x1b[32m';
const R = '\x1b[31m';
const Y = '\x1b[33m';
const D = '\x1b[2m';
const X = '\x1b[0m';

const GOC = path.resolve(__dirname, '..');
const FILE_KET_QUA = path.join(GOC, 'nghiem-thu.md');

/** Mỗi cổng chạy tối đa 10 phút. Lâu hơn thế là treo, không phải chậm. */
const HAN_MOI_CONG_MS = 10 * 60 * 1000;

type TrangThai = 'PASS' | 'FAIL' | 'BO_QUA';

interface KetQua {
  ten: string;
  lenh: string;
  trangThai: TrangThai;
  ma: number | null;
  soDo: string;
  lyDo: string;
  giay: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiện ích
// ─────────────────────────────────────────────────────────────────────────────

/** Bỏ mã màu ANSI. File .md mà dính mã màu thì không ai đọc được. */
function sach(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function chay(lenh: string): { ma: number | null; ra: string } {
  const r = spawnSync(lenh, {
    shell: true,
    cwd: GOC,
    encoding: 'utf8',
    timeout: HAN_MOI_CONG_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ma: r.status,
    ra: sach(`${r.stdout ?? ''}${r.stderr ?? ''}`),
  };
}

/**
 * Dò một cổng TCP có ai nghe không.
 *
 * Dùng để phân biệt "cổng đỏ vì mã sai" với "cổng đỏ vì chưa bật Docker".
 * Không dùng thư viện client thật: chỉ cần biết có người nghe, và một lần bắt
 * tay TCP rẻ hơn nhiều so với dựng cả DataSource rồi chờ nó hết giờ.
 */
function coAiNghe(host: string, cong: number, hanMs = 1500): Promise<boolean> {
  return new Promise((xong) => {
    const s = new net.Socket();
    let ketThuc = false;
    const dong = (duoc: boolean) => {
      if (ketThuc) return;
      ketThuc = true;
      s.destroy();
      xong(duoc);
    };
    s.setTimeout(hanMs);
    s.once('connect', () => dong(true));
    s.once('timeout', () => dong(false));
    s.once('error', () => dong(false));
    s.connect(cong, host);
  });
}

function docCongRedis(): { host: string; cong: number } {
  const url = process.env.REDIS_URL ?? docEnvFile('REDIS_URL') ?? '';
  const m = /redis:\/\/([^:/]+):(\d+)/.exec(url);
  if (!m) return { host: '127.0.0.1', cong: 6379 };
  return { host: m[1], cong: Number(m[2]) };
}

/** Đọc một biến trong .env mà KHÔNG nạp cả file vào process.env. */
function docEnvFile(ten: string): string | null {
  const f = path.join(GOC, '.env');
  if (!fs.existsSync(f)) return null;
  const m = new RegExp(`^${ten}=(.*)$`, 'm').exec(fs.readFileSync(f, 'utf8'));
  return m ? m[1].trim() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ca đối chứng — chạy MỖI LƯỢT, không phải cờ tuỳ chọn
//
// Một bộ đo không tự chứng minh được là nó biết đọc thất bại thì vô dụng. Hai ca
// dưới đây rẻ (hai tiến trình node rỗng) và chúng chặn đúng cái lỗi nguy hiểm
// nhất của chính file này: báo PASS cho một cổng đã đỏ.
// ─────────────────────────────────────────────────────────────────────────────

function caDoiChung(): void {
  const do_ = chay(`"${process.execPath}" -e "process.exit(1)"`);
  const xanh = chay(`"${process.execPath}" -e "process.exit(0)"`);
  if (do_.ma === 0 || xanh.ma !== 0) {
    console.error(
      `${R}${B}CA ĐỐI CHỨNG HỎNG${X} — bộ đo đọc sai mã thoát ` +
        `(lệnh exit 1 đọc ra ${do_.ma}, lệnh exit 0 đọc ra ${xanh.ma}). ` +
        `Không chạy tiếp: một bộ đo không đọc nổi thất bại thì mọi con số dưới đây vô nghĩa.`,
    );
    process.exit(2);
  }
  console.log(`${D}ca đối chứng: đọc đúng exit 1 và exit 0 ✓${X}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rút số đo từ đầu ra của từng cổng
// ─────────────────────────────────────────────────────────────────────────────

function soDoLint(ra: string): string {
  const m = /Nợ lint: (\d+) \(([^)]+)\) — mốc cho phép: (\d+)/.exec(ra);
  return m ? `nợ ${m[1]} (${m[2]}) · mốc ${m[3]}` : '';
}

function soDoTest(ra: string): string {
  const suite = /Test Suites:\s+(.+)/.exec(ra);
  const test = /Tests:\s+(.+)/.exec(ra);
  if (!suite && !test) {
    return 'KHÔNG có dòng tổng kết — tiến trình chết giữa chừng';
  }
  return [suite?.[1].trim(), test?.[1].trim()].filter(Boolean).join(' · ');
}

function soDoOpenapi(): string {
  const f = path.join(GOC, 'openapi.json');
  if (!fs.existsSync(f)) return '';
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8')) as {
      paths?: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    const route = Object.keys(d.paths ?? {}).length;
    const schema = Object.keys(d.components?.schemas ?? {}).length;
    return `${route} route · ${schema} schema`;
  } catch {
    return 'openapi.json không đọc được';
  }
}

function soDoTuPassFail(ra: string): string {
  const pass = (ra.match(/✓ PASS/g) ?? []).length;
  const fail = (ra.match(/✗ FAIL/g) ?? []).length;
  if (pass + fail === 0) return '';
  return `${pass} mục PASS${fail ? `, ${fail} mục FAIL` : ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Danh sách cổng
// ─────────────────────────────────────────────────────────────────────────────

interface Cong {
  ten: string;
  lenh: string;
  /** Trả về null nếu đủ điều kiện, hoặc lý do bỏ qua. */
  dieuKien?: () => Promise<string | null>;
  soDo?: (ra: string) => string;
}

async function canMySQL(): Promise<string | null> {
  const cong = Number(process.env.TEST_DB_PORT ?? 3307);
  const host = process.env.TEST_DB_HOST ?? '127.0.0.1';
  return (await coAiNghe(host, cong))
    ? null
    : `không ai nghe ở ${host}:${cong} — chạy: docker start zoldify-test-mysql`;
}

async function canRedis(): Promise<string | null> {
  const { host, cong } = docCongRedis();
  return (await coAiNghe(host, cong))
    ? null
    : `không ai nghe ở ${host}:${cong} — xem REDIS_URL trong .env`;
}

async function canCaHai(): Promise<string | null> {
  return (await canMySQL()) ?? (await canRedis());
}

/**
 * `check:core` KHÔNG chạy trên database dev — nó thuộc `zoldify_bulk_test`.
 *
 * Mục (c) của nó đòi `orders` ≥ 500k ("quy mô đạt yêu cầu đề bài",
 * `scripts/selfcheck.ts:91`), và theo `docs/BAN-GIAO.md` mục 6 thì database đó
 * phải được dựng bằng `migration + seed + seed:bulk` (~2 phút).
 *
 * Đo ngày 08/10: chạy nó trên `zoldify_dev` cho ra
 * `✗ FAIL quy mô orders < 500k (chỉ 1)` — và trong `nghiem-thu.md` thì nó nằm
 * cạnh một cổng đỏ THẬT (`check:drift`, 7 dòng lệch) với cùng một ô ❌ y như
 * nhau. Người đọc không có cách nào phân biệt.
 *
 * Nên: thiếu dữ liệu là BỎ QUA kèm lý do, không phải HỎNG. Đó đúng là việc file
 * này sinh ra để làm — tách "đỏ vì môi trường" khỏi "đỏ vì mã". Dò bằng CHÍNH
 * con số mà cổng kia sẽ dò, chứ không chỉ dò tên database: dựng đúng tên mà
 * quên `seed:bulk` thì vẫn là thiếu điều kiện.
 */
async function canDbBulk(): Promise<string | null> {
  const thieu = await canDbDev();
  if (thieu) return thieu;

  const host = process.env.DB_HOST ?? docEnvFile('DB_HOST') ?? 'localhost';
  const port = Number(process.env.DB_PORT ?? docEnvFile('DB_PORT') ?? 3306);
  const user = process.env.DB_USERNAME ?? docEnvFile('DB_USERNAME') ?? 'root';
  const pass = process.env.DB_PASSWORD ?? docEnvFile('DB_PASSWORD') ?? '';
  const db = process.env.DB_DATABASE ?? docEnvFile('DB_DATABASE') ?? 'zoldify';

  const r = chay(
    `"${process.execPath}" -e "const m=require('mysql2/promise');` +
      `m.createConnection({host:'${host}',port:${port},user:'${user}',` +
      `password:'${pass}',database:'${db}',connectTimeout:3000})` +
      `.then(async c=>{const[[x]]=await c.query('SELECT COUNT(*) n FROM orders');` +
      `await c.end();console.log(x.n)}).catch(()=>{console.log(-1)})"`,
  );
  const soDon = Number(r.ra.trim().split('\n').pop());

  // `-1` là không đọc được bảng (chưa migrate). Cũng là thiếu điều kiện, không
  // phải hỏng mã.
  if (soDon < 0) {
    return `${db} chưa có bảng orders — cần migration + seed + seed:bulk`;
  }
  if (soDon < 500_000) {
    return (
      `${db} chỉ có ${soDon.toLocaleString('vi-VN')} đơn, cổng này đòi ≥ 500k — ` +
      'nó thuộc zoldify_bulk_test (xem docs/BAN-GIAO.md mục 6: seed:bulk)'
    );
  }
  return null;
}

/**
 * Sáu cổng dưới đây nối vào DATABASE DEV qua `src/data-source.ts` (`.env` DB_*,
 * mặc định `zoldify` ở cổng 3306) — không phải `zoldify_test`. Chúng cần một
 * lược đồ do MIGRATION dựng: `check:drift` so entity với database thật,
 * `check:index` đọc `EXPLAIN`, `check:constraints` kiểm CHECK/UNIQUE.
 *
 * Dò bằng một lần BẮT TAY THẬT, không chỉ mở cổng TCP: đo ngày 07/10 trên máy
 * này thì 3306 CÓ người nghe nhưng trả `Access denied for user root@localhost`
 * — tức có một MySQL cục bộ khác mật khẩu. Dò bằng TCP thì tưởng đủ điều kiện,
 * rồi sáu cổng đỏ vì lý do chẳng liên quan tới mã, và "đỏ vì môi trường" lẫn
 * vào "đỏ vì mã" đúng thứ file này sinh ra để tách.
 */
async function canDbDev(): Promise<string | null> {
  const host = process.env.DB_HOST ?? docEnvFile('DB_HOST') ?? 'localhost';
  const port = Number(process.env.DB_PORT ?? docEnvFile('DB_PORT') ?? 3306);
  const user = process.env.DB_USERNAME ?? docEnvFile('DB_USERNAME') ?? 'root';
  const pass = process.env.DB_PASSWORD ?? docEnvFile('DB_PASSWORD') ?? '';
  const db = process.env.DB_DATABASE ?? docEnvFile('DB_DATABASE') ?? 'zoldify';

  if (!(await coAiNghe(host, port))) {
    return `không ai nghe ở ${host}:${port} (database dev, không phải DB test)`;
  }

  const r = chay(
    `"${process.execPath}" -e "const m=require('mysql2/promise');` +
      `m.createConnection({host:'${host}',port:${port},user:'${user}',` +
      `password:'${pass}',database:'${db}',connectTimeout:3000})` +
      `.then(c=>c.end()).then(()=>process.exit(0)).catch(e=>{` +
      `console.error(e.message);process.exit(1)})"`,
  );
  if (r.ma !== 0) {
    return `${host}:${port}/${db} — ${r.ra.trim().split('\n')[0] || 'không nối được'}`;
  }
  return null;
}

const CONG: Cong[] = [
  { ten: 'build', lenh: 'npm run build' },
  { ten: 'lint:check', lenh: 'npm run lint:check', soDo: soDoLint },
  { ten: 'openapi:check', lenh: 'npm run openapi:check', soDo: soDoOpenapi },
  {
    ten: 'test',
    lenh: 'npm test',
    dieuKien: canMySQL,
    soDo: soDoTest,
  },
  { ten: 'check:compose', lenh: 'npm run check:compose', soDo: soDoTuPassFail },
  {
    ten: 'check:boot',
    lenh: 'npm run check:boot',
    dieuKien: canCaHai,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:audit',
    lenh: 'npm run check:audit',
    dieuKien: canMySQL,
    soDo: soDoTuPassFail,
  },
  // ── BẢY CỔNG CÒN LẠI TRONG `npm run check` ────────────────────────────────
  //
  // Thêm ngày 07/10 sau một lần BÁO SAI.
  //
  // Bản đầu của file này chỉ chạy bảy cổng, và `check:worker` không nằm trong
  // số đó. Hậu quả đo được: `nghiem-thu.md` ghi **ĐẠT** cho commit b14fef5
  // trong khi `WorkerModule` KHÔNG DỰNG ĐƯỢC — `TasksService` đòi
  // `ProductRepository` mà `TasksModule` không khai (hỏng từ 06/10, commit
  // 9882fba). Worker production chết lúc khởi động: không huỷ đơn quá hạn,
  // không chốt vận đơn, không flush view_count.
  //
  // Không cổng nào khác bắt được: `npm test` xanh vì spec tự
  // `new TasksService(...)`; `check:boot` xanh vì AppModule có sẵn
  // ProductsModule. Chỉ `check:worker` dựng WorkerModule thật.
  //
  // Bài học: một bộ nghiệm thu BỎ SÓT một cổng thì tệ hơn không có bộ nghiệm
  // thu — nó dán nhãn ĐẠT lên một cây đang hỏng, và người đọc thôi tự kiểm.
  //
  // Liệt kê TỪNG cổng chứ không gọi `npm run check` một cục: gộp lại thì một
  // cổng bỏ qua vì thiếu database sẽ kéo cả cụm thành HỎNG, và "đỏ vì môi
  // trường" lại lẫn vào "đỏ vì mã".
  { ten: 'check:ci', lenh: 'npm run check:ci', soDo: soDoTuPassFail },
  { ten: 'check:backup', lenh: 'npm run check:backup', soDo: soDoTuPassFail },
  {
    ten: 'check:redis',
    lenh: 'npm run check:redis',
    dieuKien: canRedis,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:worker',
    lenh: 'npm run check:worker',
    dieuKien: canCaHai,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:core',
    lenh: 'npm run check:core',
    dieuKien: canDbBulk,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:index',
    lenh: 'npm run check:index',
    dieuKien: canDbDev,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:constraints',
    lenh: 'npm run check:constraints',
    dieuKien: canDbDev,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:drift',
    lenh: 'npm run check:drift',
    dieuKien: canDbDev,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:race',
    lenh: 'npm run check:race',
    dieuKien: canDbDev,
    soDo: soDoTuPassFail,
  },
  {
    ten: 'check:cache',
    lenh: 'npm run check:cache',
    dieuKien: canDbDev,
    soDo: soDoTuPassFail,
  },
  // `canCaHai` chứ không `canMySQL`: bài này cần CẢ Redis. Không có Redis thì
  // `phat()` im lặng bỏ qua (đúng cho production) và cổng sẽ đỏ với thông điệp
  // "socket không nhận được gói nào" — tức báo sai nguyên nhân. Chính script
  // cũng tự dò Redis ở mục 1 và dừng sớm, nhưng dò ở đây mới cho ra BỎ QUA kèm
  // lý do thay vì HỎNG.
  {
    ten: 'check:stock',
    lenh: 'npm run check:stock',
    dieuKien: canCaHai,
    soDo: soDoTuPassFail,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Trạng thái git
// ─────────────────────────────────────────────────────────────────────────────

function mot(lenh: string): string {
  return chay(lenh).ra.trim();
}

interface TrangThaiGit {
  nhanh: string;
  sha: string;
  tieuDe: string;
  banFile: string[];
}

function docGit(): TrangThaiGit {
  const banFile = mot('git status --short')
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean)
    // Bỏ qua CHÍNH file kết quả: nó sinh ra ở cuối lượt chạy này, nên đòi cây
    // phải sạch kể cả nó là một điều kiện không bao giờ thoả được.
    .filter((d) => !d.endsWith('nghiem-thu.md'));
  return {
    nhanh: mot('git rev-parse --abbrev-ref HEAD'),
    sha: mot('git rev-parse --short HEAD'),
    tieuDe: mot('git log -1 --format=%s'),
    banFile,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chạy
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `${B}═══ NGHIỆM THU — chạy mọi cổng, ghi kết quả ra nghiem-thu.md ═══${X}\n`,
  );
  caDoiChung();
  console.log('');

  const ketQua: KetQua[] = [];

  // Chạy một phần, để gỡ lỗi và để làm ca đối chứng cho CHÍNH file này mà không
  // phải chờ hết sáu phút:
  //
  //   NGHIEM_THU_CHI=lint:check npm run nghiem-thu
  //
  // Lọc rồi thì kết luận KHÔNG bao giờ là ĐẠT — những cổng không chạy chưa
  // chứng minh gì cả, và một lượt chạy lọc mà báo ĐẠT là đúng cái bẫy file này
  // sinh ra để chặn.
  const loc = (process.env.NGHIEM_THU_CHI ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const danhSach = loc.length ? CONG.filter((c) => loc.includes(c.ten)) : CONG;
  if (loc.length) {
    const ten = danhSach.map((c) => c.ten).join(', ');
    console.log(
      `${Y}CHẠY LỌC${X} ${D}— chỉ ${ten}. Kết luận sẽ không bao giờ là ĐẠT.${X}\n`,
    );
  }

  for (const c of danhSach) {
    const lyDo = c.dieuKien ? await c.dieuKien() : null;
    if (lyDo) {
      console.log(`  ${Y}⊘ BỎ QUA${X}  ${c.ten} ${D}— ${lyDo}${X}`);
      ketQua.push({
        ten: c.ten,
        lenh: c.lenh,
        trangThai: 'BO_QUA',
        ma: null,
        soDo: '',
        lyDo,
        giay: 0,
      });
      continue;
    }

    process.stdout.write(`  ${D}… đang chạy ${c.ten}${X}`);
    const batDau = Date.now();
    const r = chay(c.lenh);
    const giay = Math.round((Date.now() - batDau) / 100) / 10;
    const soDo = c.soDo ? c.soDo(r.ra) : '';
    const dat = r.ma === 0;

    process.stdout.write('\r\x1b[K');
    console.log(
      `  ${dat ? `${G}✓ PASS` : `${R}✗ FAIL`}${X}  ${c.ten}` +
        `  ${D}EXIT=${r.ma ?? '?'} · ${giay}s${soDo ? ` · ${soDo}` : ''}${X}`,
    );

    ketQua.push({
      ten: c.ten,
      lenh: c.lenh,
      trangThai: dat ? 'PASS' : 'FAIL',
      ma: r.ma,
      soDo,
      lyDo: dat ? '' : layDongLoi(r.ra),
      giay,
    });
  }

  const git = docGit();
  const caySach = git.banFile.length === 0;
  console.log(
    `  ${caySach ? `${G}✓ PASS` : `${R}✗ FAIL`}${X}  cây làm việc sạch` +
      `  ${D}${caySach ? '' : `${git.banFile.length} file chưa commit`}${X}`,
  );

  const soHong = ketQua.filter((k) => k.trangThai === 'FAIL').length;
  const soBoQua = ketQua.filter((k) => k.trangThai === 'BO_QUA').length;
  const ketLuan =
    soHong > 0 || !caySach
      ? 'HỎNG'
      : soBoQua > 0 || loc.length
        ? 'CHƯA ĐỦ'
        : 'ĐẠT';

  ghiFile(ketQua, git, caySach, ketLuan);

  console.log('');
  const mau = ketLuan === 'ĐẠT' ? G : ketLuan === 'CHƯA ĐỦ' ? Y : R;
  console.log(`${mau}${B}═══ ${ketLuan} ═══${X}`);
  if (ketLuan === 'CHƯA ĐỦ') {
    console.log(
      `${D}${soBoQua} cổng bị bỏ qua vì thiếu điều kiện. "Bỏ qua" không phải "đạt".${X}`,
    );
  }
  console.log(`${D}Đã ghi: nghiem-thu.md${X}`);

  process.exit(ketLuan === 'ĐẠT' ? 0 : 1);
}

/**
 * Rút phần có ích trong đầu ra của một cổng đỏ, để dán vào `nghiem-thu.md`.
 *
 * LẤY TỐI ĐA 12 DÒNG, KHÔNG PHẢI MỘT.
 *
 * Bản đầu lấy đúng một dòng: dòng đầu khớp một mẫu ưu tiên, hoặc dòng cuối nếu
 * không mẫu nào khớp. Đo ngày 08/10 trên lượt chạy thật của commit 4ffbd2e:
 * `check:drift` đỏ với BẢY câu ALTER cụ thể, mà file chỉ ghi được
 * "nếu entity đúng. Đừng hạ ngưỡng để đi qua." — tức dòng gợi ý cuối cùng, vô
 * nghĩa với người đọc. Một bản ghi nghiệm thu không nói được cổng đỏ vì cái gì
 * thì không còn là bằng chứng, chỉ còn là một ô màu đỏ.
 *
 * Mẫu `^\s*(ALTER|DROP|CREATE|RENAME) ` có mặt vì đó đúng hình dạng đầu ra của
 * `check:drift`, cổng duy nhất kể lỗi bằng SQL chứ không bằng dòng `✗ FAIL`.
 */
function layDongLoi(ra: string): string {
  const dong = ra.split('\n').map((d) => d.trimEnd());
  const uuTien = [
    /✗ FAIL/,
    /error TS\d+/,
    /vấn đề lint MỚI/,
    /^(Error|TypeError|ReferenceError):/,
    /FAIL src\//,
    /^\s*(ALTER|DROP|CREATE|RENAME) /,
  ];

  // Gom THEO MẪU, không gom theo thứ tự dòng: một cổng vừa có `✗ FAIL` vừa có
  // vệt `error TS` thì dòng FAIL mới là dòng người đọc cần trước.
  const lay: string[] = [];
  for (const mau of uuTien) {
    for (const d of dong) {
      if (!mau.test(d)) continue;
      const sach = d.trim().slice(0, 200);
      if (sach && !lay.includes(sach)) lay.push(sach);
      if (lay.length >= 12) break;
    }
    if (lay.length >= 12) break;
  }
  if (lay.length) return lay.join('\n');

  // Không mẫu nào khớp: lấy NĂM dòng cuối, không phải một. Dòng cuối rất hay là
  // dòng gợi ý chung chung, còn nguyên nhân nằm ngay trên nó.
  return dong.filter(Boolean).slice(-5).map((d) => d.slice(0, 200)).join('\n');
}

function ghiFile(
  ketQua: KetQua[],
  git: TrangThaiGit,
  caySach: boolean,
  ketLuan: string,
): void {
  const luc = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const bieuTuong: Record<TrangThai, string> = {
    PASS: '✅ PASS',
    FAIL: '❌ FAIL',
    BO_QUA: '⊘ BỎ QUA',
  };

  const d: string[] = [];
  d.push('# Nghiệm thu');
  d.push('');
  d.push(`**Kết luận: ${ketLuan}**`);
  d.push('');
  d.push(
    'File này do `npm run nghiem-thu` ghi ra. Đừng sửa tay — sửa thì nó mất ' +
      'giá trị làm bằng chứng, và lượt chạy sau ghi đè.',
  );
  d.push('');
  d.push(`- Lúc: ${luc}`);
  d.push(`- Nhánh: \`${git.nhanh}\``);
  d.push(`- HEAD: \`${git.sha}\` — ${git.tieuDe}`);
  d.push('');
  d.push('| Cổng | Kết quả | Mã thoát | Số đo | Giây |');
  d.push('|---|---|---|---|---|');
  for (const k of ketQua) {
    const ma = k.ma === null ? '—' : String(k.ma);
    const chuThich = k.trangThai === 'BO_QUA' ? k.lyDo : k.soDo;
    d.push(
      `| \`${k.lenh}\` | ${bieuTuong[k.trangThai]} | ${ma} | ${chuThich || '—'} | ${k.giay || '—'} |`,
    );
  }
  d.push(
    `| cây làm việc sạch | ${caySach ? '✅ PASS' : '❌ FAIL'} | — | ${
      caySach ? 'không có file chưa commit' : `${git.banFile.length} file chưa commit`
    } | — |`,
  );
  d.push('');

  const hong = ketQua.filter((k) => k.trangThai === 'FAIL');
  if (hong.length) {
    d.push('## Cổng hỏng');
    d.push('');
    for (const k of hong) {
      d.push(`### \`${k.lenh}\` — EXIT ${k.ma ?? '?'}`);
      d.push('');
      d.push('```');
      d.push(k.lyDo || '(không rút được dòng lỗi — chạy lại lệnh để xem)');
      d.push('```');
      d.push('');
    }
  }

  const boQua = ketQua.filter((k) => k.trangThai === 'BO_QUA');
  if (boQua.length) {
    d.push('## Cổng bị bỏ qua');
    d.push('');
    d.push('"Bỏ qua" KHÔNG phải "đạt" — những cổng này chưa chứng minh gì cả.');
    d.push('');
    for (const k of boQua) d.push(`- \`${k.lenh}\` — ${k.lyDo}`);
    d.push('');
  }

  if (!caySach) {
    d.push('## File chưa commit');
    d.push('');
    d.push('```');
    for (const f of git.banFile) d.push(f);
    d.push('```');
    d.push('');
    d.push(
      'Chạy lệnh trong cây chưa commit rồi báo cáo là lỗi đã lặp sáu vòng: ' +
        'con số đo được không thuộc về commit nào, nên không ai kiểm lại được. ' +
        'Commit hết rồi chạy lại.',
    );
    d.push('');
  }

  fs.writeFileSync(FILE_KET_QUA, d.join('\n') + '\n', 'utf8');
}

main().catch((e: unknown) => {
  console.error(`${R}Nghiệm thu chết giữa chừng:${X}`, e);
  process.exit(2);
});
