/**
 * ĐO SỨC CHỊU ĐỰNG (soak / endurance) — bắn tải VỪA trong nhiều phút, lấy mẫu
 * rss/heap/lag/độ trễ theo thời gian, rồi hỏi bộ phân tích: backend có RÒ hay
 * TRÔI không.
 *
 *   npm run loadtest:soak                    # mặc định 20 phút
 *   SOAK_PHUT=30 npm run loadtest:soak       # 30 phút
 *   SOAK_PHUT=2 SOAK_MAU_GIAY=10 SOAK_WARMUP_PHUT=0 npm run loadtest:soak   # smoke nhanh
 *   SOAK_LEAK=1 SOAK_PHUT=2 SOAK_MAU_GIAY=10 SOAK_WARMUP_PHUT=0 npm run loadtest:soak  # rò cố ý → phải ĐỎ
 *
 * ─── Khác loadtest ở đâu ─────────────────────────────────────────────────────
 * `loadtest` đo TRẦN tức thời: mỗi route × mức song song chạy 5 giây. Soak chạy
 * MỘT mức vừa phải (sau rate limit thật) trong hàng chục phút và chỉ quan tâm
 * MỘT câu: các con số có TRÔI theo thời gian không. Rò 2 MB/phút thì 5 giây vô
 * hình, 30 phút thì +60 MB.
 *
 * ─── Vì sao vẫn phải tách tiến trình (pre-mortem K1) ─────────────────────────
 * Bộ bắn tải chung tiến trình với server thì chính nó giữ CPU, `event loop lag`
 * đo ra là lag DO PHÉP ĐO GÂY RA. Nên: con dựng app + tự đo lag của chính mình,
 * cha bắn tải và hỏi con qua IPC. Khuôn này lấy từ `loadtest.ts`.
 *
 * ─── Chạy thật cần gì ────────────────────────────────────────────────────────
 * Docker Desktop bật +
 *   - MySQL test 3307, DB `zoldify_sqlaudit` đã seed (buyer@/admin@) — thiếu thì
 *     TỪ CHỐI, không báo "khoẻ" trên bảng rỗng (K6).
 *   - Redis test 6380 — BẮT BUỘC: không có Redis thì route có cache treo 10s mỗi
 *     request (xem chú thích REDIS_URL). Runner ping Redis trước, chết thì TỪ CHỐI.
 *       docker run -d --name zoldify-test-mysql -p 3307:3306 \
 *         -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=zoldify_sqlaudit mysql:8
 *       docker run -d --name zoldify-test-redis -p 6380:6379 redis:7
 * Bộ phân tích kiểm riêng, KHÔNG cần Docker: `npm run check:chiu-dung`.
 */
import { fork, ChildProcess } from 'child_process';
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import {
  danhGiaChiuDung,
  MauChiuDung,
  NGUONG_MAC_DINH,
} from './danh-gia-chiu-dung';

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
// ─── Redis BẮT BUỘC cho soak (đo thật, đã dính) ─────────────────────────────
// Chép mặc định "không Redis" của loadtest vào đây là SAI. Đo được: KHÔNG Redis
// thì các route có cache treo trên offline-queue của ioredis — mỗi request đợi
// tới trần 10s rồi chết, cả bài chỉ qua ~6 request/mẫu, lỗi 83%, p95 ghim 10s
// TRONG KHI event loop lag chỉ 16ms (process rảnh, đang đợi async, không nghẽn
// CPU). CÓ Redis thì cùng tải SONG=5: ~5.600 req/10s, p95 17ms, lỗi 0%, ĐẠT.
// Nên soak mặc định trỏ Redis test 6380 (giống cách mặc định DB 3307). Muốn cố
// ý đo nhánh KHÔNG cache thì đặt SOAK_NO_REDIS=1 (biết trước là sẽ treo).
if (E.SOAK_NO_REDIS === '1') delete E.REDIS_URL;
else E.REDIS_URL ??= 'redis://127.0.0.1:6380';

// Chặn cứng: không bao giờ bắn tải dài vào DB thật (K8). Tên phải chứa "audit".
const DB = E.DB_DATABASE ?? '';
if (!/audit/i.test(DB)) {
  console.error(`Từ chối: DB_DATABASE = "${DB}" — tên phải chứa "audit".`);
  process.exit(1);
}

const PHUT = Number(E.SOAK_PHUT ?? 20);
const MAU_GIAY = Number(E.SOAK_MAU_GIAY ?? 30);
const WARMUP_PHUT = Number(E.SOAK_WARMUP_PHUT ?? 3);
const SONG = Number(E.SOAK_SONG ?? 20);
const RO_CO_Y = E.SOAK_LEAK === '1';
// Trần thời gian MỘT request. Đã dính: không có trần thì một request đứng là
// một worker kẹt `await fetch` mãi, `Promise.all` không bao giờ xong → cả bài
// soak treo im, 15 kết nối nằm im 49s mà không ghi được gì. Quá trần tính là lỗi.
const TIMEOUT_REQ_MS = Number(E.SOAK_REQ_TIMEOUT_MS ?? 10000);

// ═══════════════════════════════════════════════════════════════════════════
// TIẾN TRÌNH CON — dựng app, tự đo vòng lặp sự kiện + bộ nhớ của chính mình
// ═══════════════════════════════════════════════════════════════════════════

interface TinDo {
  type: 'do';
  lagP50: number;
  lagP99: number;
  lagMax: number;
  rssMB: number;
  heapMB: number;
  poolTong: number | null;
  poolCho: number | null;
}
type TinCha = { type: 'moc' } | { type: 'bao' };

// Giữ rác cố ý khi SOAK_LEAK=1: mỗi lần lấy mẫu nhét thêm một khối vào đây để
// rss leo tuyến tính — dùng để CHỨNG MINH cả đường ống (runner + bộ phân tích)
// ra đỏ thật, không chỉ bộ phân tích đỏ với số giả (pre-mortem K2).
const RAC: Buffer[] = [];

async function chayServer(): Promise<void> {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
  require('reflect-metadata');
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { ThrottlerStorage } = require('@nestjs/throttler');
  const { Reflector } = require('@nestjs/core');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../src/app.module');
  const { configureRouting } = require('../src/core/routing.config');
  const { TransformInterceptor } = require('../src/core/transform.interceptor');
  const { HttpExceptionFilter } = require('../src/core/http-exception.filter');

  // Tắt rate limit bằng cách thay KHO ĐẾM của throttler (không phải overrideGuard
  // — xem cái bẫy APP_GUARD ghi kỹ trong loadtest.ts). Giới hạn thật 10 rps để
  // nguyên thì soak chỉ đo throttler, không đo máy.
  const khoDem = {
    increment: () =>
      Promise.resolve({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
  };
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useValue(khoDem)
    .compile();

  const app = mod.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  configureRouting(app);
  await app.listen(0);
  const cong = (app.getHttpServer().address() as { port: number }).port;

  // Đọc pool mysql2 (best-effort). Là nội bộ của driver nên bọc try/catch và
  // KHÔNG đưa vào phán quyết — chỉ in kèm báo cáo để người đọc thấy pool có bò
  // lên không. Phán quyết rò/trôi dựa trên rss/heap/lag/độ trễ.
  const docPool = (): { tong: number | null; cho: number | null } => {
    try {
      const ds = app.get(DataSource);
      const p = ds?.driver?.pool;
      if (!p) return { tong: null, cho: null };
      return {
        tong: Array.isArray(p._allConnections) ? p._allConnections.length : null,
        cho: Array.isArray(p._connectionQueue) ? p._connectionQueue.length : null,
      };
    } catch {
      return { tong: null, cho: null };
    }
  };
  /* eslint-enable */

  const h: IntervalHistogram = monitorEventLoopDelay({ resolution: 1 });
  h.enable();

  process.on('message', (m: TinCha) => {
    if (m.type === 'moc') {
      h.reset();
      return;
    }
    // 'bao': chốt một lần lấy mẫu.
    if (RO_CO_Y) RAC.push(Buffer.alloc(2 * 1024 * 1024, 1)); // +2 MB mỗi mẫu
    if (global.gc) global.gc(); // ép GC khi chạy --expose-gc để heap đọc sạch (K4)
    const mem = process.memoryUsage();
    const pool = docPool();
    const tin: TinDo = {
      type: 'do',
      lagP50: h.percentile(50) / 1e6,
      lagP99: h.percentile(99) / 1e6,
      lagMax: h.max / 1e6,
      rssMB: mem.rss / 1024 / 1024,
      heapMB: mem.heapUsed / 1024 / 1024,
      poolTong: pool.tong,
      poolCho: pool.cho,
    };
    process.send?.(tin);
  });

  process.send?.({ type: 'san-sang', cong });
}

// ═══════════════════════════════════════════════════════════════════════════
// TIẾN TRÌNH CHA — bắn tải đều, lấy mẫu theo thời gian
// ═══════════════════════════════════════════════════════════════════════════

const pct = (a: number[], p: number): number => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const i = Math.min(b.length - 1, Math.floor((p / 100) * b.length));
  return Math.round(b[i] * 100) / 100;
};

/** Giữ `song` request đang bay, xoay vòng qua `duongs`, trong `giay` giây. */
async function banTai(
  base: string,
  duongs: Array<{ duong: string; token: string | null }>,
  song: number,
  giay: number,
): Promise<{ do: number[]; loi: number; tong: number }> {
  const dos: number[] = [];
  let loi = 0;
  let tong = 0;
  let k = 0;
  const het = Date.now() + giay * 1000;
  const mot = async (): Promise<void> => {
    while (Date.now() < het) {
      const r = duongs[k++ % duongs.length];
      const headers: Record<string, string> = r.token ? { Authorization: 'Bearer ' + r.token } : {};
      const t0 = process.hrtime.bigint();
      try {
        // signal: cắt request quá TIMEOUT_REQ_MS → ném AbortError → tính 1 lỗi,
        // worker đi tiếp, không khoá cả bài đo (xem chú thích TIMEOUT_REQ_MS).
        const res = await fetch(base + r.duong, { headers, signal: AbortSignal.timeout(TIMEOUT_REQ_MS) });
        await res.arrayBuffer();
        if (res.status >= 400) loi++;
      } catch {
        loi++;
      }
      dos.push(Number(process.hrtime.bigint() - t0) / 1e6);
      tong++;
    }
  };
  await Promise.all(Array.from({ length: song }, () => mot()));
  return { do: dos, loi, tong };
}

/** TCP tới host:port trong `giay` giây — true nếu bắt tay được. */
function thongMang(host: string, port: number, giay: number): Promise<boolean> {
  return new Promise((ok) => {
    const s = net.connect({ host, port });
    const xong = (kq: boolean): void => { s.destroy(); ok(kq); };
    s.setTimeout(giay * 1000);
    s.once('connect', () => xong(true));
    s.once('timeout', () => xong(false));
    s.once('error', () => xong(false));
  });
}

async function main(): Promise<void> {
  // Fail-fast Redis: nếu KHÔNG ping được Redis trước khi tốn ~60s dựng app thì
  // mọi route có cache sẽ treo 10s/request (xem chú thích REDIS_URL). Thà từ chối
  // ngay còn hơn chạy xong mới thấy lỗi 83%. Bỏ qua khi SOAK_NO_REDIS=1.
  if (E.REDIS_URL) {
    const u = new URL(E.REDIS_URL);
    const host = u.hostname || '127.0.0.1';
    const port = Number(u.port || 6379);
    if (!(await thongMang(host, port, 3))) {
      console.error(
        `Từ chối: không nối được Redis ${host}:${port} (REDIS_URL=${E.REDIS_URL}).\n` +
          `  Dựng: docker run -d --name zoldify-test-redis -p 6380:6379 redis:7\n` +
          `  Hoặc SOAK_NO_REDIS=1 để cố ý đo nhánh KHÔNG cache (sẽ treo ở route có cache).`,
      );
      process.exit(1);
    }
  }

  console.log('▶ Dựng server ở tiến trình riêng (để phép đo không tự làm nghẽn nó)…');
  const con: ChildProcess = fork(__filename, [], {
    // --expose-gc để con ép GC trước khi đọc heap, cho số heap sạch nhiễu GC.
    execArgv: [...process.execArgv, '--expose-gc'],
    env: {
      ...process.env,
      SOAK_ROLE: 'server',
      // Con kế thừa `-r ts-node/register` của cha, nên nó typecheck CẢ đồ thị
      // AppModule. Đồ thị đó kéo theo lỗi type có sẵn ở các file chẳng liên
      // quan gì soak (vd `nen-anh.ts` thiếu kiểu `sharp`, các file .spec) —
      // đủ để con chết lúc biên dịch trước cả khi chạm DB. Soak chỉ cần app
      // CHẠY, không cần typecheck; bật transpile-only để bỏ qua các lỗi đó.
      TS_NODE_TRANSPILE_ONLY: '1',
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const cong = await new Promise<number>((ok, hong) => {
    const h = setTimeout(() => hong(new Error('server không lên sau 120s — Docker/MySQL 3307 đã bật chưa?')), 120000);
    con.on('message', (m: { type: string; cong?: number }) => {
      if (m.type === 'san-sang' && m.cong) { clearTimeout(h); ok(m.cong); }
    });
    con.on('exit', (code) => { clearTimeout(h); hong(new Error('server thoát sớm, mã ' + String(code) + ' — thường là không nối được DB')); });
  });
  const base = 'http://127.0.0.1:' + cong;
  console.log(`  server ở ${base}`);

  const dangNhap = async (email: string): Promise<string> => {
    const r = await fetch(base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: '123456' }),
    });
    const j = (await r.json()) as { data?: { access_token?: string } };
    if (!j.data?.access_token) throw new Error(`không đăng nhập được ${email} — DB zoldify_sqlaudit đã seed chưa? (npm run sql:audit:seed)`);
    return j.data.access_token;
  };

  console.log('▶ Đăng nhập (cũng là phép kiểm DB đã seed — K6)…');
  const tBuyer = await dangNhap('buyer@zoldify.com');
  const tAdmin = await dangNhap('admin@zoldify.com');

  // Trộn đường công khai (cache) + đường cần token + đường admin: soak cần đi
  // qua nhiều lối cấp phát khác nhau để rò ở bất kỳ đâu cũng lộ.
  const duongs: Array<{ duong: string; token: string | null }> = [
    { duong: '/api/v1/products?currentPage=1&limit=20', token: null },
    { duong: '/api/v1/categories', token: null },
    { duong: '/api/v1/products?currentPage=2&limit=20', token: null },
    { duong: '/api/v1/orders?currentPage=1&limit=10', token: tBuyer },
    { duong: '/api/v1/admin/stats', token: tAdmin },
  ];

  const hoiDo = (): Promise<TinDo> =>
    new Promise((ok, loi) => {
      // Con không trả 'do' trong 20s thì coi phép đo hỏng — thà chết TO còn hơn
      // treo im (lần đầu cha kẹt chờ, 15 kết nối nằm im 49s mà không báo gì).
      const h = setTimeout(() => {
        con.off('message', nghe as never);
        con.kill();
        loi(new Error('con không trả số đo sau 20s — server có thể đã kẹt/chết'));
      }, 20000);
      const nghe = (m: TinDo): void => {
        if (m.type === 'do') { clearTimeout(h); con.off('message', nghe as never); ok(m); }
      };
      con.on('message', nghe as never);
      con.send({ type: 'bao' } satisfies TinCha);
    });

  const soLuot = Math.max(1, Math.round((PHUT * 60) / MAU_GIAY));
  console.log(
    `▶ Soak: ${PHUT} phút, ${SONG} request song song, lấy mẫu mỗi ${MAU_GIAY}s ` +
      `(${soLuot} mẫu), bỏ ${WARMUP_PHUT} phút warmup${RO_CO_Y ? ' — RÒ CỐ Ý BẬT' : ''}…`,
  );

  const t0 = Date.now();
  const mau: MauChiuDung[] = [];
  const pool: Array<{ tong: number | null; cho: number | null }> = [];
  for (let i = 0; i < soLuot; i++) {
    con.send({ type: 'moc' } satisfies TinCha); // reset cửa sổ lag cho lượt này
    const kq = await banTai(base, duongs, SONG, MAU_GIAY);
    const d = await hoiDo();
    const tPhut = (Date.now() - t0) / 60000;
    mau.push({
      tPhut,
      rssMB: Math.round(d.rssMB * 10) / 10,
      heapMB: Math.round(d.heapMB * 10) / 10,
      p95ms: pct(kq.do, 95),
      lagP99ms: Math.round(d.lagP99 * 100) / 100,
      loiTyLe: kq.tong ? kq.loi / kq.tong : 0,
    });
    pool.push({ tong: d.poolTong, cho: d.poolCho });
    const m = mau[mau.length - 1];
    console.log(
      `  [${String(i + 1).padStart(2)}/${soLuot}] t=${tPhut.toFixed(1)}′ ` +
        `rss=${m.rssMB}MB heap=${m.heapMB}MB p95=${m.p95ms}ms lag99=${m.lagP99ms}ms ` +
        `lỗi=${(m.loiTyLe * 100).toFixed(1)}% pool=${d.poolTong ?? '?'}/chờ${d.poolCho ?? '?'} ` +
        `(${kq.tong} req)`,
    );
  }

  const nguong = { ...NGUONG_MAC_DINH, warmupPhut: WARMUP_PHUT };
  const kl = danhGiaChiuDung(mau, nguong);

  console.log('\n' + '═'.repeat(60));
  console.log(kl.dat ? '✓ ĐẠT — backend giữ ổn định suốt bài đo.' : '✗ ĐỎ — có dấu hiệu rò/trôi:');
  for (const l of kl.lyDo) console.log('  • ' + l);
  console.log('═'.repeat(60));

  ghiBaoCao(mau, pool, kl, nguong);

  // Dừng con rồi thoát theo đúng kết quả (K7: báo cáo theo MÃ THOÁT, không theo ý định).
  con.kill();
  process.exit(kl.dat ? 0 : 1);
}

function ghiBaoCao(
  mau: MauChiuDung[],
  pool: Array<{ tong: number | null; cho: number | null }>,
  kl: ReturnType<typeof danhGiaChiuDung>,
  nguong: typeof NGUONG_MAC_DINH,
): void {
  const GOC = path.resolve(__dirname, '..');
  let sha = '(không rõ)';
  try { sha = execSync('git rev-parse --short HEAD', { cwd: GOC, encoding: 'utf8' }).trim(); } catch { /* không sao */ }

  const L: string[] = [];
  L.push('# Kết quả đo sức chịu đựng (soak)');
  L.push('');
  L.push(`- HEAD: \`${sha}\``);
  L.push(`- Thời điểm: ${new Date().toISOString()}`);
  L.push(`- Cấu hình: ${PHUT} phút · ${SONG} song song · mẫu/${MAU_GIAY}s · warmup ${nguong.warmupPhut}′${RO_CO_Y ? ' · RÒ CỐ Ý' : ''}`);
  L.push(`- Kết luận: **${kl.dat ? 'ĐẠT' : 'ĐỎ'}**`);
  for (const l of kl.lyDo) L.push(`  - ${l}`);
  L.push('');
  L.push('## Số đo rút ra');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| Dốc RSS | ${kl.soDo.docRss} MB/phút (ngưỡng ${nguong.docRssMBmoiPhut}) |`);
  L.push(`| Dốc heap | ${kl.soDo.docHeap} MB/phút (ngưỡng ${nguong.docHeapMBmoiPhut}) |`);
  L.push(`| p95 nửa đầu → sau | ${kl.soDo.p95Dau} → ${kl.soDo.p95Sau} ms |`);
  L.push(`| lag p99 nửa đầu → sau | ${kl.soDo.lagDau} → ${kl.soDo.lagSau} ms |`);
  L.push(`| lỗi nửa đầu → sau | ${(kl.soDo.loiDau * 100).toFixed(2)}% → ${(kl.soDo.loiSau * 100).toFixed(2)}% |`);
  L.push(`| số mẫu xét (sau warmup) | ${kl.soDo.soMauXet} |`);
  L.push('');
  L.push('## Chuỗi mẫu');
  L.push('');
  L.push('| t (phút) | rss MB | heap MB | p95 ms | lag99 ms | lỗi % | pool/chờ |');
  L.push('|---|---|---|---|---|---|---|');
  mau.forEach((m, i) => {
    const p = pool[i];
    L.push(`| ${m.tPhut.toFixed(1)} | ${m.rssMB} | ${m.heapMB} | ${m.p95ms} | ${m.lagP99ms} | ${(m.loiTyLe * 100).toFixed(1)} | ${p.tong ?? '?'}/${p.cho ?? '?'} |`);
  });
  L.push('');

  const f = path.join(GOC, 'chiu-dung.md');
  fs.writeFileSync(f, L.join('\n'), 'utf8');
  console.log(`\n→ Đã ghi ${f}`);
}

if (E.SOAK_ROLE === 'server') {
  chayServer().catch((e: unknown) => { console.error(e); process.exit(1); });
} else {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
