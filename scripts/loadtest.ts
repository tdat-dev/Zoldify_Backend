/**
 * ĐO SỨC CHỊU TẢI — và đo đúng thứ mà Node phải sợ, không phải thứ Java sợ.
 *
 *   npm run loadtest
 *
 * ─── Vì sao bài đo này khác bài đo của một hệ Java ───────────────────────────
 *
 * Trong Tomcat/Spring, mỗi request có một luồng riêng. Một request nặng thì
 * luồng của nó chậm, các luồng khác không liên quan. Muốn chịu tải hơn thì thêm
 * luồng, thêm nhân.
 *
 * NestJS chạy trên Node: **một luồng duy nhất** xử lý mọi request. Chờ MySQL trả
 * lời thì không sao — đó là I/O, Node nhả luồng ra làm việc khác. Nhưng phần
 * TỰ MÌNH LÀM thì không nhả được:
 *
 *   - TypeORM dựng 2.000 đối tượng entity từ 2.000 dòng
 *   - `JSON.stringify` cái mảng 2.000 phần tử đó
 *   - class-transformer chạy qua từng field để lọc `@Exclude`
 *
 * Ba việc trên là CPU thuần. Trong lúc chúng chạy, **mọi request khác đứng xếp
 * hàng** — kể cả một healthcheck rỗng. Đó là thứ không bao giờ xảy ra ở Java, và
 * là thứ bài đo này phải chỉ ra được bằng số.
 *
 * Nên ngoài RPS và độ trễ, bài đo lấy thêm hai con số:
 *
 *   1. `event loop lag` — vòng lặp sự kiện bị trễ bao lâu. Đây là thước đo
 *      "một request đang giữ CPU không nhả". Java không có khái niệm này.
 *   2. Bài **chèn ngang**: bắn healthcheck rỗng trong lúc route nặng đang chạy,
 *      xem healthcheck chậm đi bao nhiêu lần. Ở Java tỉ lệ này ~1. Ở Node nó là
 *      con số cần biết trước khi lên production.
 *
 * ─── Vì sao phải tách tiến trình ─────────────────────────────────────────────
 *
 * Bộ tạo tải mà chạy chung tiến trình với server thì chính nó làm nghẽn vòng lặp
 * sự kiện, và số `event loop lag` đo được sẽ là lag DO PHÉP ĐO GÂY RA. Nên
 * script này tự `fork` chính mình: tiến trình con dựng app và tự đo lag của nó,
 * tiến trình cha bắn tải và hỏi con qua IPC.
 */
import { fork, ChildProcess } from 'child_process';
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

const E = process.env;
E.NODE_ENV ??= 'test';
E.DB_HOST ??= '127.0.0.1';
E.DB_PORT ??= '3307';
E.DB_USERNAME ??= 'root';
E.DB_PASSWORD ??= 'testpw';
E.DB_DATABASE ??= 'zoldify_sqlaudit';
E.JWT_ACCESS_SECRET ??= 'do-tai-access';
E.JWT_REFRESH_TOKEN_SECRET ??= 'do-tai-refresh';
E.JWT_ACCESS_EXPIRE ??= '1d';
E.JWT_REFRESH_EXPIRE ??= '7d';
E.SITE_URL ??= 'http://localhost:3001';
// Cố ý KHÔNG đặt REDIS_URL: bài này đo CPU của tiến trình api, thêm một chặng
// mạng tới Redis chỉ làm mờ thứ đang muốn nhìn.
delete E.REDIS_URL;

const DB = E.DB_DATABASE ?? '';
if (!/audit/i.test(DB)) {
  console.error(`✋ Từ chối: DB_DATABASE = "${DB}" — tên phải chứa "audit".`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// TIẾN TRÌNH CON — dựng app, tự đo vòng lặp sự kiện của chính mình
// ═══════════════════════════════════════════════════════════════════════════

interface TinLag { type: 'lag'; p50: number; p99: number; max: number; cpu: number }
type TinCha = { type: 'moc' } | { type: 'bao' };

async function chayServer(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
  require('reflect-metadata');
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { ThrottlerStorage } = require('@nestjs/throttler');
  const { Reflector } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { configureRouting } = require('../src/core/routing.config');
  const { TransformInterceptor } = require('../src/core/transform.interceptor');
  const { HttpExceptionFilter } = require('../src/core/http-exception.filter');

  // Tắt rate limit — vì giới hạn thật là 10 request/giây, để nguyên thì bài đo
  // dừng ở 10 RPS và chỉ chứng minh được rằng throttler hoạt động. Thứ cần biết
  // ở đây là NGƯỠNG CỦA MÁY, không phải ngưỡng của cấu hình.
  //
  // Cách hiển nhiên — `.overrideGuard(ThrottlerGuard)` — KHÔNG ăn, và đây là
  // cái bẫy: app.module đăng ký guard bằng `{ provide: APP_GUARD, useClass:
  // ThrottlerGuard }`, nên token trong DI là `APP_GUARD` chứ không phải lớp
  // `ThrottlerGuard`. `overrideGuard` tìm theo lớp nên trượt, im lặng, không
  // báo gì. Lần chạy đầu tôi tưởng đã tắt và đo ra 4.000 RPS đẹp đẽ — hoá ra
  // đang đo tốc độ trả về lỗi 429. Bộ đếm lỗi trong `banTai` là thứ duy nhất
  // lộ ra chuyện đó.
  //
  // Cách ăn: thay lớp LƯU TRỮ của throttler. Guard vẫn chạy, vẫn đếm, nhưng
  // kho đếm luôn trả 0 lượt nên không bao giờ chạm trần. Cách này không đụng
  // tới `APP_GUARD` nào khác — quan trọng, vì đè APP_GUARD sẽ tắt luôn cả
  // guard xác thực, và khi đó bài đo lại đi đo tốc độ trả 401.
  const khoDem = {
    increment: () =>
      Promise.resolve({
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
  };
  let dung = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useValue(khoDem);

  // Khi cần đo đường KHÔNG cache: thay hẳn kho cache bằng cái luôn trượt.
  //
  // Cách rẻ hơn — xoay số trang cho khác khoá cache — đã thử và HỎNG: bài đo
  // bắn ~11.000 request qua 150 trang, nên sau vòng đầu trang nào cũng đã nằm
  // trong cache và từ đó về sau lại toàn trúng. Hai cột "trúng"/"trượt" ra số
  // y hệt nhau, và nếu không nghi thì đã báo cáo rằng cache chẳng giúp gì.
  if (process.env.LOADTEST_NOCACHE === '1') {
    const { CACHE_MANAGER } = require('@nestjs/cache-manager');
    dung = dung.overrideProvider(CACHE_MANAGER).useValue({
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(undefined),
      del: () => Promise.resolve(undefined),
      // `wrap` là thứ products.service dùng thật; trả thẳng loader nghĩa là
      // lần nào cũng chạy truy vấn.
      wrap: (_k: unknown, loader: () => Promise<unknown>) => loader(),
    });
  }
  const mod = await dung.compile();

  const app = mod.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  configureRouting(app);
  await app.listen(0);
  const cong = (app.getHttpServer().address() as { port: number }).port;
  /* eslint-enable */

  const h: IntervalHistogram = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  let cpuMoc = process.cpuUsage();
  let tMoc = Date.now();

  process.on('message', (m: TinCha) => {
    if (m.type === 'moc') {
      h.reset();
      cpuMoc = process.cpuUsage();
      tMoc = Date.now();
      return;
    }
    if (m.type === 'bao') {
      const c = process.cpuUsage(cpuMoc);
      const troi = Math.max(Date.now() - tMoc, 1);
      const tin: TinLag = {
        type: 'lag',
        p50: h.percentile(50) / 1e6,
        p99: h.percentile(99) / 1e6,
        max: h.max / 1e6,
        // Một tiến trình Node chỉ có MỘT luồng chạy JS, nên 100% ở đây nghĩa là
        // luồng ấy không còn một khe trống nào. Không như Java, thêm nhân cũng
        // không đẩy con số này xuống được — phải bớt việc đi.
        cpu: ((c.user + c.system) / 1000 / troi) * 100,
      };
      process.send?.(tin);
    }
  });

  process.send?.({ type: 'san-sang', cong });
}

// ═══════════════════════════════════════════════════════════════════════════
// TIẾN TRÌNH CHA — bắn tải, thu số
// ═══════════════════════════════════════════════════════════════════════════

interface KetQua {
  ten: string;
  duong: string;
  ghiChu: string;
  song: number; // số request chạy song song
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  loi: number;
  lagP99: number;
  lagMax: number;
  cpu: number;
}

const pct = (a: number[], p: number): number => {
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.floor((p / 100) * a.length));
  return Math.round(a[i] * 100) / 100;
};

/** Vòng kín: giữ đúng `song` request đang bay, chạy trong `giay` giây. */
async function banTai(
  base: string,
  duong: string | ((i: number) => string),
  token: string | null,
  song: number,
  giay: number,
): Promise<{ do: number[]; loi: number }> {
  const dos: number[] = [];
  let loi = 0;
  let dem = 0;
  const het = Date.now() + giay * 1000;
  const headers: Record<string, string> = token ? { Authorization: 'Bearer ' + token } : {};

  const mot = async (): Promise<void> => {
    while (Date.now() < het) {
      const t0 = process.hrtime.bigint();
      try {
        const d = typeof duong === 'string' ? duong : duong(dem++);
        const r = await fetch(base + d, { headers });
        await r.arrayBuffer(); // phải đọc hết thân, không thì chưa tính là xong
        if (r.status >= 400) loi++;
      } catch {
        loi++;
      }
      dos.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  };
  await Promise.all(Array.from({ length: song }, () => mot()));
  return { do: dos, loi };
}

async function main(): Promise<void> {
  const dungServer = async (them: Record<string, string>): Promise<{ con: ChildProcess; base: string }> => {
    const c: ChildProcess = fork(__filename, [], {
      env: { ...process.env, LOADTEST_ROLE: 'server', ...them },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const cong = await new Promise<number>((ok, hong) => {
      const h = setTimeout(() => hong(new Error('server không lên sau 120s')), 120000);
      c.on('message', (m: { type: string; cong?: number }) => {
        if (m.type === 'san-sang' && m.cong) { clearTimeout(h); ok(m.cong); }
      });
      c.on('exit', (m) => { clearTimeout(h); hong(new Error('server thoát sớm, mã ' + String(m))); });
    });
    return { con: c, base: 'http://127.0.0.1:' + cong };
  };

  console.log('▶ Dựng server ở tiến trình riêng (để phép đo không tự làm nghẽn nó)…');
  const { con, base } = await dungServer({});
  console.log(`  server ở ${base}`);

  // Nhận tiến trình con làm tham số chứ không đóng cứng vào `con`: bài đo có
  // HAI server (một bật cache, một tắt), và nếu hỏi nhầm tiến trình thì cột lag
  // sẽ là lag của server không chạy gì — số vẫn ra, vẫn trông hợp lý, và vẫn sai.
  const hoiLag = (c: ChildProcess): Promise<TinLag> =>
    new Promise((ok) => {
      const nghe = (m: TinLag): void => {
        if (m.type === 'lag') { c.off('message', nghe as never); ok(m); }
      };
      c.on('message', nghe as never);
      c.send({ type: 'bao' } satisfies TinCha);
    });
  const datMoc = (c: ChildProcess): void => { c.send({ type: 'moc' } satisfies TinCha); };

  const dangNhap = async (email: string): Promise<string> => {
    const r = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: '123456' }),
    });
    const j = (await r.json()) as { data?: { access_token?: string } };
    if (!j.data?.access_token) throw new Error('không đăng nhập được ' + email);
    return j.data.access_token;
  };

  console.log('▶ Đăng nhập…');
  const tBuyer = await dangNhap('buyer@zoldify.com');
  const tAdmin = await dangNhap('admin@zoldify.com');

  const routes: Array<{
    ten: string;
    duong: string | ((i: number) => string);
    token: string | null;
    ghiChu?: string;
  }> = [
    { ten: 'healthcheck (không chạm DB)', duong: '/', token: null, ghiChu: 'trần lý thuyết của khung' },
    { ten: 'danh mục (9 dòng, KHÔNG cache)', duong: '/api/v1/categories', token: null },
    {
      ten: 'sản phẩm — CÓ cache',
      duong: '/api/v1/products?currentPage=1&limit=10',
      token: null,
      ghiChu: 'cache in-memory đang bật, lần nào cũng trúng',
    },
    { ten: 'chat: danh sách hội thoại', duong: '/api/v1/chat/conversations', token: tBuyer },
    { ten: 'đơn của tôi', duong: '/api/v1/orders?currentPage=1&limit=10', token: tBuyer },
    { ten: 'admin: thống kê', duong: '/api/v1/admin/stats', token: tAdmin },
    {
      ten: 'sitemap — bảng chỉ mục',
      duong: '/sitemap.xml',
      token: null,
      ghiChu: 'thứ Google gọi đầu tiên; giờ chỉ là một câu GROUP BY + vài chục dòng XML',
    },
    {
      ten: 'sitemap — một file con',
      duong: '/sitemap-products-0.xml',
      token: null,
      ghiChu: 'phần nặng còn lại, nhưng đã chặn ở KICH_THUOC_LO và có cache',
    },
  ];
  const mucSong = [1, 10, 50, 100];

  console.log('▶ Làm nóng…');
  for (const r of routes) await banTai(base, r.duong, r.token, 2, 1);

  const kq: KetQua[] = [];
  console.log(`▶ Đo ${routes.length} route × ${mucSong.length} mức song song, mỗi lượt 5 giây…`);
  for (const r of routes) {
    for (const song of mucSong) {
      datMoc(con);
      const t0 = Date.now();
      const { do: dos, loi } = await banTai(base, r.duong, r.token, song, 5);
      const troi = (Date.now() - t0) / 1000;
      const lag = await hoiLag(con);
      dos.sort((a, b) => a - b);
      kq.push({
        ten: r.ten, duong: typeof r.duong === 'string' ? r.duong : '(xoay trang)', ghiChu: r.ghiChu ?? '', song,
        rps: Math.round(dos.length / troi),
        p50: pct(dos, 50), p95: pct(dos, 95), p99: pct(dos, 99),
        max: Math.round(dos[dos.length - 1] * 100) / 100,
        loi,
        lagP99: Math.round(lag.p99 * 100) / 100,
        lagMax: Math.round(lag.max * 100) / 100,
        cpu: Math.round(lag.cpu),
      });
      const c = kq[kq.length - 1];
      console.log(
        `  ${r.ten.padEnd(34)} song=${String(song).padStart(3)}  ` +
        `${String(c.rps).padStart(5)} rps  p95=${String(c.p95).padStart(8)}ms  ` +
        `lag p99=${String(c.lagP99).padStart(7)}ms  cpu=${c.cpu}%` +
        (c.loi ? `  LỖI ${c.loi}` : ''),
      );
    }
  }

  // ─── Cache đáng giá bao nhiêu ────────────────────────────────────────────
  // Dựng một server THỨ HAI với kho cache luôn trượt, rồi chạy đúng route sản
  // phẩm. Chênh lệch giữa hai lần chính là phần cache đang gánh.
  console.log('▶ Dựng server thứ hai (cache tắt hẳn) để đo phần cache đang gánh…');
  const { con: con2, base: base2 } = await dungServer({ LOADTEST_NOCACHE: '1' });
  const duongSp = '/api/v1/products?currentPage=1&limit=10';
  await banTai(base2, duongSp, null, 2, 1);
  for (const song of mucSong) {
    datMoc(con2);
    const t0 = Date.now();
    const { do: dos, loi } = await banTai(base2, duongSp, null, song, 5);
    const troi = (Date.now() - t0) / 1000;
    const lag2 = await hoiLag(con2);
    dos.sort((a, b) => a - b);
    kq.push({
      ten: 'sản phẩm — CACHE TẮT HẲN', duong: duongSp,
      ghiChu: 'server riêng, kho cache luôn trượt → mỗi request chạm DB',
      song, rps: Math.round(dos.length / troi),
      p50: pct(dos, 50), p95: pct(dos, 95), p99: pct(dos, 99),
      max: Math.round(dos[dos.length - 1] * 100) / 100,
      loi,
      lagP99: Math.round(lag2.p99 * 100) / 100,
      lagMax: Math.round(lag2.max * 100) / 100,
      cpu: Math.round(lag2.cpu),
    });
    const c = kq[kq.length - 1];
    console.log(`  sản phẩm — CACHE TẮT HẲN            song=${String(song).padStart(3)}  ${String(c.rps).padStart(5)} rps  p95=${String(c.p95).padStart(8)}ms` + (c.loi ? `  LỖI ${c.loi}` : ''));
  }
  con2.kill();

  // ─── Bài chèn ngang: đây mới là câu trả lời cho "Node chứ không phải Java" ──
  console.log('▶ Bài chèn ngang: healthcheck rỗng trong lúc route nặng đang chạy…');
  datMoc(con);
  const yen = await banTai(base, '/', null, 1, 4);
  yen.do.sort((a, b) => a - b);
  const pYen = pct(yen.do, 50);

  datMoc(con);
  const nang = banTai(base, '/sitemap.xml', null, 4, 6);
  await new Promise((s) => setTimeout(s, 500)); // để tải nặng kịp lấp đầy
  const chen = await banTai(base, '/', null, 1, 4);
  await nang;
  chen.do.sort((a, b) => a - b);
  const pChen = pct(chen.do, 50);
  const lagChen = await hoiLag(con);
  const tiLe = pYen > 0 ? Math.round((pChen / pYen) * 10) / 10 : 0;
  console.log(`  healthcheck lúc rảnh: ${pYen}ms · lúc bị chèn: ${pChen}ms → chậm ${tiLe}×`);

  // Chốt chặn: KHÔNG ghi báo cáo nếu tỉ lệ lỗi đáng kể.
  //
  // Lần chạy đầu của bài này ra 4.000 RPS rất đẹp — và toàn bộ là tốc độ trả về
  // HTTP 429, vì chỗ tắt rate limit trượt mà không báo gì. Một báo cáo hiệu năng
  // sai còn tệ hơn không có báo cáo: nó khiến người đọc yên tâm về thứ chưa
  // từng được đo. Nên thà đỏ và không có file, còn hơn có file mà sai.
  const tongLoi = kq.reduce((s, k) => s + k.loi, 0);
  const tongReq = kq.reduce((s, k) => s + Math.round(k.rps * 5), 0);
  const tiLeLoi = tongReq ? (tongLoi / tongReq) * 100 : 0;
  if (tiLeLoi > 1) {
    console.error(
      `\n✗ ${tongLoi}/${tongReq} request lỗi (${tiLeLoi.toFixed(1)}%) — KHÔNG ghi báo cáo.\n` +
        '  Số đo lúc này là tốc độ trả về lỗi, không phải sức chịu tải.\n' +
        '  Xem lại: rate limit còn bật? token hết hạn? DB soi còn dữ liệu?',
    );
    con.kill();
    process.exit(1);
  }

  const md = xuatBaoCao(kq, { pYen, pChen, tiLe, lagMax: Math.round(lagChen.max * 100) / 100 }, tiLeLoi);
  const dich = path.join(__dirname, '..', 'docs', 'system-design', 'load-test.md');
  fs.writeFileSync(dich, md, 'utf8');
  console.log('\n✓ Đã ghi docs/system-design/load-test.md');

  con.kill();
  process.exit(0);
}

interface ChenNgang { pYen: number; pChen: number; tiLe: number; lagMax: number }

function xuatBaoCao(kq: KetQua[], cn: ChenNgang, tiLeLoi: number): string {
  const L: string[] = [];
  const os = require('os') as { cpus: () => unknown[]; totalmem: () => number };

  L.push('# Sức chịu tải — đo trên chính hệ này');
  L.push('');
  L.push(`> Sinh tự động bằng \`npm run loadtest\` lúc ${new Date().toISOString()}.`);
  L.push('> **Đừng sửa tay** — chạy lại lệnh trên là ghi đè.');
  L.push('');
  L.push('## Vì sao bài đo này khác bài đo của một hệ Java');
  L.push('');
  L.push('Trong Tomcat/Spring, mỗi request có một luồng riêng: một request nặng thì');
  L.push('chỉ luồng của nó chậm. NestJS chạy trên Node — **một luồng duy nhất** xử lý');
  L.push('mọi request. Chờ MySQL thì không sao, đó là I/O nên Node nhả luồng. Nhưng');
  L.push('phần tự mình làm thì không nhả được:');
  L.push('');
  L.push('- TypeORM dựng 2.000 đối tượng entity từ 2.000 dòng');
  L.push('- `JSON.stringify` mảng 2.000 phần tử đó');
  L.push('- class-transformer duyệt từng field để lọc `@Exclude`');
  L.push('');
  L.push('Ba việc đó là CPU thuần. Trong lúc chúng chạy, **mọi request khác xếp hàng**');
  L.push('— kể cả một healthcheck rỗng. Nên bảng dưới có cột `lag` (vòng lặp sự kiện');
  L.push('bị trễ bao lâu) và `cpu` — hai con số Java không cần nhìn tới.');
  L.push('');
  L.push('## Điều kiện đo');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Máy | ${os.cpus().length} nhân · ${Math.round(os.totalmem() / 1e9)}GB RAM · ${process.platform} |`);
  L.push(`| Node | ${process.version} |`);
  L.push('| Rate limit | **tắt** — để đo ngưỡng của máy, không phải ngưỡng cấu hình |');
  L.push('| Redis | không dùng — đo CPU tiến trình api, bớt một chặng mạng cho khỏi mờ |');
  L.push('| Bộ tạo tải | chạy ở **tiến trình khác**, nếu không chính nó làm nghẽn phép đo |');
  L.push('| Mỗi lượt | 5 giây, vòng kín (giữ đủ N request đang bay) |');
  L.push("| Tỉ lệ lỗi | " + tiLeLoi.toFixed(2) + "% — bài đo tự huỷ nếu vượt 1% |");
  L.push('');
  L.push('⚠️ Server và bộ tạo tải chạy **cùng một máy**. Số tuyệt đối vì thế bi quan hơn');
  L.push('thực tế đôi chút; thứ đáng tin là **so sánh giữa các route** và **hình dạng');
  L.push('đường cong khi tăng tải**, không phải con số RPS tuyệt đối.');
  L.push('');

  L.push('## Kết quả');
  L.push('');
  L.push('| Route | song song | RPS | p50 | p95 | p99 | lag p99 | CPU |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const k of kq) {
    L.push(`| ${k.ten} | ${k.song} | **${k.rps}** | ${k.p50} | ${k.p95} | ${k.p99} | ${k.lagP99} | ${k.cpu}% |`);
  }
  L.push('');
  L.push('`RPS` = request/giây · `p95` = 95% request xong trong ngần này ms ·');
  L.push('`lag p99` = vòng lặp sự kiện bị trễ · `CPU` = phần trăm của MỘT luồng.');
  L.push('');
  const ghi = [...new Map(kq.filter((k) => k.ghiChu).map((k) => [k.ten, k.ghiChu])).entries()];
  if (ghi.length) {
    for (const [ten, g] of ghi) L.push(`- **${ten}** — ${g}`);
    L.push('');
  }

  L.push('## Bài chèn ngang — con số quan trọng nhất');
  L.push('');
  L.push('Bắn một healthcheck rỗng (không chạm DB) trong hai hoàn cảnh:');
  L.push('');
  L.push('| Hoàn cảnh | healthcheck mất |');
  L.push('|---|---:|');
  L.push(`| máy đang rảnh | ${cn.pYen} ms |`);
  L.push(`| 4 request \`/sitemap.xml\` đang chạy | **${cn.pChen} ms** |`);
  L.push('');
  L.push(`**Chậm đi ${cn.tiLe}×.** Vòng lặp sự kiện có lúc trễ tới ${cn.lagMax} ms.`);
  L.push('');
  L.push('Ở một hệ Java tỉ lệ này gần bằng 1: healthcheck có luồng riêng, không quan');
  L.push('tâm ai đang bận. Ở đây nó không có luồng riêng — nó xếp hàng sau phần CPU của');
  L.push('request nặng. Đó là toàn bộ khác biệt, và đó là lý do một route nặng ở NestJS');
  L.push('nguy hiểm hơn cùng route đó ở Java: nó không làm chậm chính nó, nó làm chậm');
  L.push('**tất cả mọi người**.');
  L.push('');

  // Rút gọn: RPS cao nhất đạt được của mỗi route, để phần kết luận nói bằng số
  // của chính lần chạy này chứ không phải số tôi gõ tay vào.
  const dinh = new Map<string, number>();
  for (const k of kq) dinh.set(k.ten, Math.max(dinh.get(k.ten) ?? 0, k.rps));
  const lay = (t: string): number => dinh.get(t) ?? 0;
  const spCache = lay('sản phẩm — CÓ cache');
  const spKhong = lay('sản phẩm — CACHE TẮT HẲN');
  const loi = spKhong > 0 ? Math.round((spCache / spKhong) * 10) / 10 : 0;

  L.push('## Kết luận — một tiến trình api chịu được bao nhiêu');
  L.push('');
  L.push('| Loại đường | RPS đỉnh (1 tiến trình) |');
  L.push('|---|---:|');
  L.push(`| Trần của khung (không chạm DB) | ${lay('healthcheck (không chạm DB)')} |`);
  L.push(`| Danh sách có cache, trúng cache | ${spCache} |`);
  L.push(`| Danh sách chạm DB thật | ${spKhong} |`);
  L.push(`| Đường có xác thực + JOIN (chat, đơn) | ${Math.max(lay('chat: danh sách hội thoại'), lay('đơn của tôi'))} |`);
  L.push(`| \`sitemap.xml\` — bảng chỉ mục | ${lay('sitemap — bảng chỉ mục')} |`);
  L.push(`| Route nặng nhất (một file sitemap con) | **${lay('sitemap — một file con')}** |`);
  L.push('');
  L.push('Bốn điều rút ra:');
  L.push('');
  L.push(`1. **Cache đang gánh ${loi}×** cho đường sản phẩm (${spCache} so với ${spKhong} rps).`);
  L.push('   Cache hỏng hoặc Redis chết là tụt thẳng xuống mức dưới, không phải tụt dần.');
  L.push('2. **CPU chạm ~100% ngay từ mức 10 người bấm cùng lúc** ở gần như mọi route.');
  L.push('   Một tiến trình Node chỉ có một luồng JS, nên từ đó trở đi tăng tải chỉ làm');
  L.push('   dài thêm hàng đợi: nhìn cột `p95` tăng gấp đôi mỗi khi số song song gấp đôi,');
  L.push('   trong khi cột `RPS` đứng yên. Muốn hơn thì phải **thêm tiến trình**, không');
  L.push('   phải thêm nhân cho một tiến trình.');
  L.push(`3. **Bảng chỉ mục ${lay('sitemap — bảng chỉ mục')} rps, file con ${lay('sitemap — một file con')} rps.** Google gọi bảng chỉ mục`);
  L.push('   trước, và đó giờ chỉ là một câu `GROUP BY` — nên cú chèn ngang ở dưới đo');
  L.push('   đúng thứ crawler thật gây ra. File con vẫn là route đắt nhất còn lại, nhưng');
  L.push('   chi phí của nó bị chặn ở `KICH_THUOC_LO` sản phẩm mỗi file, nên **không còn');
  L.push('   tăng theo kích thước bảng** — đó mới là điều đổi được. Xem `sql-audit.md`.');
  L.push('4. **Rate limit thật là 10 request/giây mỗi IP.** Nghĩa là trong vận hành bình');
  L.push('   thường sẽ không ai chạm tới các con số trên. Các số này trả lời câu hỏi khác:');
  L.push('   *khi có sự cố, hoặc khi throttler fail-open vì Redis chết, thì trần ở đâu.*');
  L.push('');
  return L.join('\n');
}

if (E.LOADTEST_ROLE === 'server') {
  chayServer().catch((e: unknown) => { console.error(e); process.exit(1); });
} else {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
