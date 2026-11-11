/**
 * BỘ KIỂM SỨC KHOẺ CỤM ĐANG CHẠY — hộp đen, gọi HTTP thật qua Caddy.
 *
 * Chạy (cụm compose phải đang lên — `npm run docker:up`):
 *   npm run check:suc-khoe
 *   SUC_KHOE_URL=https://api-staging.example npm run check:suc-khoe   (ở xa: nhóm A tự bỏ qua)
 *
 * VÌ SAO CẦN BÀI NÀY KHI ĐÃ CÓ 15 SUITE.
 *
 * Mọi suite trong `selfcheck-all.ts` đều tự dựng app trong tiến trình của nó
 * (`NestFactory.create`) hoặc đọc file cấu hình. Không suite nào hỏi CỤM ĐANG
 * CHẠY: request đi qua Caddy → một trong ba bản api → MySQL/Redis của cụm. Cả
 * ba chỗ hỏng hay gặp nhất đều nằm ngoài tầm chúng:
 *
 *   - Caddy chỉ đẩy về một bản api (DNS `dynamic a` không làm mới) — mọi
 *     suite vẫn xanh vì chúng không đi qua Caddy.
 *   - Throttler từng bản đếm riêng thay vì đếm chung qua Redis — giới hạn
 *     10 req/s thực chất thành 30 req/s. `check:redis` chứng minh mã đúng,
 *     không chứng minh cụm hôm nay đang đấu đúng dây.
 *   - Redis của cụm chết: `/health` vẫn 200 (đúng thiết kế, xem
 *     `health.service.ts`), Docker vẫn báo healthy. Không ai nhìn thấy.
 *
 * PRE-MORTEM (viết trước khi viết mã):
 *
 *   R1  Throttler 10/1s · 50/10s · 300/60s dùng CHUNG qua Redis, mà mọi
 *       request của bài này từ cùng một IP → tự dính 429 thành đỏ giả.
 *       → giãn đều GIAN_CACH_MS giữa các request (~3,3 req/s, 33/10s < 50);
 *         bài nổ tải đặt CUỐI CÙNG.
 *   R2  Caddy `least_conn` với request tuần tự thì mọi bản cùng 0 kết nối, nó
 *       chọn ngẫu nhiên → ca "đủ 3 bản" có thể chập chờn.
 *       → 20 mẫu: xác suất sót một bản ≈ 3·(2/3)^20 ≈ 0,09 %.
 *   R3  `/health` trả `redis: "off"` khi thiếu REDIS_URL mà vẫn 200. Trong cụm
 *       compose "off" nghĩa là đấu thiếu dây → tính là FAIL, không phải PASS.
 *   R4  Bài hộp đen không có "mã để sửa" nên không có lượt đỏ tự nhiên.
 *       → nghiệm thu bằng TIÊM LỖI: `docker stop zoldify_backend-redis-1`, chạy
 *         lại, các ca Redis/throttler phải đỏ; bật lại thì phải xanh.
 *   R5  Không có Docker (chạy ở xa, CI) → nhóm A BỎ QUA có ghi rõ, không đếm
 *       là xanh. Bỏ qua mà in PASS là nói dối.
 *   R6  Database rỗng → ca sản phẩm đỏ vì môi trường. Lời nhắn phải nói rõ
 *       "thiếu dữ liệu" để không ai đi sửa mã.
 */
import { execFileSync } from 'child_process';

const GOC = (process.env.SUC_KHOE_URL || 'http://localhost:8080').replace(/\/$/, '');
const DU_AN = process.env.COMPOSE_PROJECT_NAME || 'zoldify_backend';
const SO_BAN_API = Number(process.env.API_REPLICAS || 3);
// R1: 300 ms → 3,3 req/s. Bộ đếm `medium` là 50/10s; 33 < 50 còn chừa chỗ cho
// Caddy và Docker cùng gọi vào (chúng thăm dò thẳng container, không qua IP
// của mình, nhưng cứ chừa).
const GIAN_CACH_MS = 300;

let pass = 0;
let fail = 0;
let boQua = 0;
const ok = (m: string) => {
  pass++;
  console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
};
const bad = (m: string, vaLam?: string) => {
  fail++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
  if (vaLam) console.log(`          \x1b[33m↳ ${vaLam}\x1b[0m`);
};
const skip = (m: string, viSao: string) => {
  boQua++;
  console.log(`  \x1b[90m⊘ BỎ QUA\x1b[0m ${m} — ${viSao}`);
};
const kiem = (dieuKien: boolean, ten: string, vaLam?: string) =>
  dieuKien ? ok(ten) : bad(ten, vaLam);
const muc = (t: string) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PhanHoi {
  status: number;
  ms: number;
  headers: Headers;
  body: any;
  text: string;
}

let lanCuoi = 0;
/** Mọi request đi qua đây để giãn đều (R1). Lỗi mạng trả status 0, không throw. */
async function goi(
  duong: string,
  init: RequestInit = {},
  { gian = true } = {},
): Promise<PhanHoi> {
  if (gian) {
    const cho = lanCuoi + GIAN_CACH_MS - Date.now();
    if (cho > 0) await ngu(cho);
    lanCuoi = Date.now();
  }
  const t0 = performance.now();
  try {
    const r = await fetch(GOC + duong, { ...init, signal: AbortSignal.timeout(5000) });
    const text = await r.text();
    let body: any = undefined;
    try {
      body = JSON.parse(text);
    } catch {
      /* không phải JSON — để ca gọi nó tự kết luận */
    }
    return { status: r.status, ms: performance.now() - t0, headers: r.headers, body, text };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, headers: new Headers(), body: undefined, text: String(e) };
  }
}

const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
};
const tienTo = (reqId: string | null) => (reqId ?? '').split('-')[0];

// ---------------------------------------------------------------------------
// A. Container — đọc bằng `docker inspect`, chỉ khi đo cụm trên chính máy này
// ---------------------------------------------------------------------------
function nhomContainer(): void {
  muc('A. Container của cụm');
  const laMayNay = /\/\/(localhost|127\.0\.0\.1)(:|$)/.test(GOC);
  let ids: string[] = [];
  try {
    if (!laMayNay) throw new Error('đo cụm ở xa');
    ids = execFileSync('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${DU_AN}`], {
      encoding: 'utf8',
    })
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length) throw new Error(`không thấy container nào của dự án "${DU_AN}"`);
  } catch (e) {
    skip('toàn bộ nhóm A', (e as Error).message.split('\n')[0]); // R5
    return;
  }
  const dong = execFileSync(
    'docker',
    [
      'inspect',
      '-f',
      '{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.ExitCode}}',
      ...ids,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .map((l) => {
      const [dv, tt, suc, rs, oom, ma] = l.trim().split('|');
      return { dv, tt, suc, rs: Number(rs), oom: oom === 'true', ma: Number(ma) };
    });
  const theo = (dv: string) => dong.filter((d) => d.dv === dv);

  const api = theo('api');
  const apiKhoe = api.filter((d) => d.tt === 'running' && d.suc === 'healthy');
  kiem(
    apiKhoe.length === SO_BAN_API,
    `A1 api: ${apiKhoe.length}/${SO_BAN_API} bản running + healthy`,
    `trạng thái: ${api.map((d) => `${d.tt}/${d.suc || '-'}`).join(', ')}`,
  );
  // Một container khởi động lại liên tục vẫn có lúc "running healthy" đúng khoảnh
  // khắc mình nhìn. RestartCount và OOMKilled mới kể được chuyện đã xảy ra.
  const banHong = dong.filter((d) => d.rs > 0 || d.oom);
  kiem(
    banHong.length === 0,
    'A2 không container nào từng khởi động lại hay bị giết vì hết bộ nhớ',
    banHong.map((d) => `${d.dv}: restarts=${d.rs} oom=${d.oom}`).join('; '),
  );
  for (const dv of ['mysql', 'redis']) {
    const d = theo(dv)[0];
    kiem(d?.tt === 'running' && d?.suc === 'healthy', `A3 ${dv} running + healthy`, d ? `${d.tt}/${d.suc}` : 'không có');
  }
  for (const dv of ['worker', 'caddy']) {
    const d = theo(dv)[0];
    kiem(d?.tt === 'running', `A4 ${dv} running`, d ? d.tt : 'không có');
  }
  // `migrate` là việc chạy một lần. Docker ghi nó "unhealthy" vì nó thừa hưởng
  // HEALTHCHECK của Dockerfile — vô nghĩa với tiến trình đã thoát. Thứ có
  // nghĩa duy nhất là mã thoát.
  const mg = theo('migrate')[0];
  if (mg) kiem(mg.tt === 'exited' && mg.ma === 0, 'A5 migrate đã chạy xong, mã thoát 0', `${mg.tt}, mã ${mg.ma}`);
  else skip('A5 migrate', 'cụm này không có dịch vụ migrate');

  // Đo lúc 11/11: image api build 12/10, còn cơ chế phiên `sid` vào `src/`
  // sau đó (commit auth gần nhất 04/11). Token cụm phát ra không có `sid`, nên
  // I6/I7 đo MÃ CŨ một tháng mà nhìn vào thì tưởng mã hiện tại hỏng. Kiểm
  // cụm mà không biết cụm chạy bản nào thì kết luận nào cũng có thể sai.
  try {
    const anh = execFileSync('docker', ['inspect', '-f', '{{.Image}}', api[0] ? ids[dong.indexOf(api[0])] : ''], {
      encoding: 'utf8',
    }).trim();
    const lucBuild = new Date(
      execFileSync('docker', ['image', 'inspect', '-f', '{{.Created}}', anh], { encoding: 'utf8' }).trim(),
    );
    const lucMa = new Date(execFileSync('git', ['log', '-1', '--format=%cI', '--', 'src'], { encoding: 'utf8' }).trim());
    const muoiPhut = 10 * 60 * 1000;
    kiem(
      lucBuild.getTime() + muoiPhut >= lucMa.getTime(),
      `A6 image api không cũ hơn src/ (build ${lucBuild.toISOString().slice(0, 16)} · mã ${lucMa.toISOString().slice(0, 16)})`,
      'cụm đang chạy mã cũ — kết quả các nhóm I/J đo bản cũ, không phải HEAD. Dựng lại: npm run docker:up',
    );
  } catch (e) {
    skip('A6 tuổi image api', (e as Error).message.split('\n')[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Kiểm sức khoẻ cụm tại ${GOC}`);
  nhomContainer();

  // -------------------------------------------------------------------------
  muc('B. Sống và khoẻ');
  const goc = await goi('/');
  if (goc.status === 0) {
    bad(`B0 không kết nối được tới ${GOC}`, `${goc.text} — cụm đã lên chưa? (npm run docker:up)`);
    return;
  }
  kiem(goc.status === 200, `B1 GET / → 200 (${goc.status})`);

  const h = await goi('/health');
  // Treo khác hẳn trả lời "down". Lượt tiêm lỗi 11/11 (dừng Redis của cụm):
  // `/health` không trả lời trong 20 giây, mà B4 lại in "API không đọc được
  // MySQL" — trong khi MySQL vẫn sống. Gợi ý sai thì người trực đi sửa nhầm chỗ.
  if (h.status === 0) {
    bad(
      `B2 GET /health TREO — không trả lời sau ${(h.ms / 1000).toFixed(1)} s`,
      'route này chạm DB và cache; GET / vẫn sống thì nghi cache (Redis) đang treo chứ không ném lỗi',
    );
  } else kiem(h.status === 200, `B2 GET /health → 200 (${h.status})`, h.text.slice(0, 200));
  kiem(h.body?.status === 'ok', `B3 /health status = ok (${h.body?.status})`);
  kiem(h.body?.db === 'up', `B4 /health db = up (${h.body?.db})`, h.status ? 'API không đọc được MySQL' : 'không có phản hồi để đọc');
  kiem(
    h.body?.redis === 'up', // R3
    `B5 /health redis = up (${h.body?.redis})`,
    h.body?.redis === 'off'
      ? 'REDIS_URL không tới được bản api — cache và throttler đang chạy riêng từng bản'
      : 'Redis của cụm không trả lời; cache/throttler đang fail-open',
  );
  // Controller cố ý trả thẳng qua `res` để Docker đọc được 503. Nếu một ngày
  // interceptor bọc nó vào phong bì {statusCode, data} thì mã ngoài luôn 200.
  kiem(
    h.body && !('statusCode' in h.body) && !('data' in h.body),
    'B6 /health KHÔNG bị bọc phong bì (mã HTTP mới là tín hiệu cho Docker)',
  );

  // -------------------------------------------------------------------------
  muc('C. Cân tải qua Caddy');
  const tienToGap = new Set<string>();
  const msHealth: number[] = [];
  let khac200 = 0;
  for (let i = 0; i < 20; i++) {
    const r = await goi('/health');
    msHealth.push(r.ms);
    if (r.status !== 200) khac200++;
    tienToGap.add(tienTo(r.headers.get('x-request-id')));
  }
  // Tiền tố mã request sinh một lần lúc khởi động (request-id.middleware.ts),
  // nên số tiền tố khác nhau = số tiến trình api đã trả lời.
  kiem(
    tienToGap.size === SO_BAN_API,
    `C1 20 request chia về ${tienToGap.size}/${SO_BAN_API} bản api (${[...tienToGap].join(', ')})`, // R2
    'Caddy không thấy đủ bản api — xem `dynamic a` trong Caddyfile',
  );
  kiem(khac200 === 0, `C2 cả 20 lượt /health đều 200 (${20 - khac200}/20)`);

  // -------------------------------------------------------------------------
  muc('D. API đọc công khai');
  const ds = await goi('/api/v1/products?pageSize=5');
  const kq = ds.body?.data?.result;
  kiem(ds.status === 200 && Array.isArray(kq), `D1 GET /products → 200, có mảng result (${ds.status})`);
  if (Array.isArray(kq) && kq.length === 0) {
    bad('D2 danh sách sản phẩm rỗng', 'THIẾU DỮ LIỆU chứ chưa chắc lỗi mã — chạy `npm run seed:demo`'); // R6
  } else {
    kiem(ds.body?.data?.meta?.total > 0, `D2 meta.total > 0 (${ds.body?.data?.meta?.total})`);
  }
  const tran = await goi('/api/v1/products?pageSize=100000');
  const co = tran.body?.data?.meta?.pageSize;
  kiem(
    tran.status === 200 && co <= 100,
    `D3 pageSize=100000 bị chặn trần (${co})`,
    'một request kéo cả bảng là cách rẻ nhất để làm sập API',
  );
  const msSanPham = [ds.ms, tran.ms];
  if (Array.isArray(kq) && kq[0]?.id) {
    const ct = await goi(`/api/v1/products/${kq[0].id}`);
    msSanPham.push(ct.ms);
    kiem(ct.status === 200 && ct.body?.data?.id === kq[0].id, `D4 GET /products/${kq[0].id} → 200, đúng id`);
  } else skip('D4 chi tiết sản phẩm', 'không có sản phẩm nào để mở');
  const khong = await goi('/api/v1/products/999999999');
  kiem(khong.status === 404, `D5 sản phẩm không tồn tại → 404, không phải 500 (${khong.status})`);
  const dm = await goi('/api/v1/categories');
  kiem(dm.status === 200 && dm.body?.data?.meta?.total > 0, `D6 GET /categories → 200, có danh mục (${dm.body?.data?.meta?.total})`);
  for (let i = 0; i < 7; i++) msSanPham.push((await goi(`/api/v1/products?pageSize=20&current=${i + 1}`)).ms);

  // -------------------------------------------------------------------------
  muc('E. Lỗi được xử lý thành 4xx, không thành 5xx');
  const lac = await goi('/api/v1/duong-khong-ton-tai');
  kiem(lac.status === 404 && lac.body?.statusCode === 404, `E1 route lạ → 404 JSON (${lac.status})`);
  const kTk = await goi('/api/v1/orders');
  kiem(kTk.status === 401, `E2 /orders không token → 401 (${kTk.status})`);
  const tkGia = await goi('/api/v1/orders', { headers: { Authorization: 'Bearer khong.phai.jwt' } });
  kiem(tkGia.status === 401, `E3 /orders token rác → 401 (${tkGia.status})`);
  const jsonHong = await goi('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{hỏng',
  });
  kiem(jsonHong.status === 400, `E4 body JSON hỏng → 400 (${jsonHong.status})`);
  const dnRong = await goi('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  kiem(dnRong.status >= 400 && dnRong.status < 500, `E5 đăng nhập body rỗng → 4xx (${dnRong.status})`);

  // -------------------------------------------------------------------------
  muc('F. Header và bề mặt lộ ra ngoài');
  kiem(goc.headers.get('x-content-type-options') === 'nosniff', 'F1 X-Content-Type-Options: nosniff');
  kiem(!!goc.headers.get('x-frame-options'), `F2 có X-Frame-Options (${goc.headers.get('x-frame-options')})`);
  kiem(!goc.headers.get('x-powered-by'), 'F3 không lộ X-Powered-By');
  const maGui = `suc-khoe-${Date.now()}`;
  const vong = await goi('/health', { headers: { 'X-Request-Id': maGui } });
  kiem(vong.headers.get('x-request-id') === maGui, 'F4 X-Request-Id hợp lệ của client được trả lại nguyên vẹn');
  // Mã này đi thẳng vào log JSON. Ký tự lạ lọt qua là người ngoài viết được
  // dòng log giả.
  const bay = await goi('/health', { headers: { 'X-Request-Id': '"}{"level":"fatal' } });
  kiem(
    bay.headers.get('x-request-id') !== '"}{"level":"fatal' && /^[A-Za-z0-9-]+$/.test(bay.headers.get('x-request-id') ?? ''),
    `F5 X-Request-Id chứa ký tự lạ bị thay (${bay.headers.get('x-request-id')})`,
  );
  // F6 tách hai ý. Bản đầu đòi "không có ACAO" cho /categories ẩn danh và
  // xanh trên image 12/10, rồi ĐỎ ngay khi dựng lại từ HEAD 11/11: cache-bien.ts
  // cố ý trả `*` (bỏ credentials) cho danh sách công khai để Cloudflare dùng
  // chung một bản cho mọi origin (docs/bao-cao/cache-cloudflare.md). Thứ thật
  // sự phải giữ: request CÓ danh tính không mở cho origin lạ, và `*` không bao
  // giờ đi cùng Allow-Credentials.
  const corsDanhTinh = await goi('/api/v1/categories', {
    headers: { Origin: 'https://ke-gian.example', Authorization: 'Bearer rac' },
  });
  const acaoDanhTinh = corsDanhTinh.headers.get('access-control-allow-origin');
  kiem(
    acaoDanhTinh !== 'https://ke-gian.example' && acaoDanhTinh !== '*',
    `F6 CORS không mở cho origin lạ khi có Authorization (${acaoDanhTinh ?? 'không có header'})`,
  );
  const corsAnDanh = await goi('/api/v1/categories', { headers: { Origin: 'https://ke-gian.example' } });
  kiem(
    corsAnDanh.headers.get('access-control-allow-origin') !== 'https://ke-gian.example' &&
      corsAnDanh.headers.get('access-control-allow-credentials') !== 'true',
    `F6b ẩn danh: không phản chiếu origin lạ, không kèm credentials (ACAO ${corsAnDanh.headers.get('access-control-allow-origin') ?? '—'}, credentials ${corsAnDanh.headers.get('access-control-allow-credentials') ?? '—'})`,
  );
  const docs = await goi('/api/docs');
  kiem(docs.status === 404 || docs.status === 401, `F7 /api/docs đóng với request ở xa (${docs.status})`, 'xem src/core/swagger-guard.ts');

  // -------------------------------------------------------------------------
  muc('G. Độ trễ (đo qua Caddy, tuần tự, không tải)');
  // Ngưỡng rộng có chủ ý: đây là "còn khoẻ không", không phải bài đo tải
  // (`npm run loadtest` lo việc đó). load-test.md đo p95 13,8 ms ở 10 song
  // song; tuần tự mà vượt 100 ms là có thứ đang nghẹt.
  const p95H = p95(msHealth);
  kiem(p95H < 100, `G1 /health p95 = ${p95H.toFixed(1)} ms (< 100 ms, ${msHealth.length} mẫu)`);
  const p95S = p95(msSanPham);
  kiem(p95S < 500, `G2 /products p95 = ${p95S.toFixed(1)} ms (< 500 ms, ${msSanPham.length} mẫu)`);

  await nhomPhienVaQuyen();

  // -------------------------------------------------------------------------
  muc('H. Throttler đếm CHUNG qua Redis (đặt cuối — cố ý tự dính 429)');
  // Bộ đếm `short` là 10/1s. Đếm chung thì 24 request dồn một lúc chỉ ≤ 10
  // cái lọt. Đếm riêng từng bản (Redis chết → fail-open sang bộ nhớ, hoặc
  // REDIS_URL thiếu) thì 24 chia ba bản ≈ 8 mỗi bản, dưới trần 10 → gần như
  // không cái nào bị 429. Ranh giới đó chính là thứ bài này gác.
  await ngu(1100); // ra khỏi cửa sổ 1s của các request giãn đều phía trên
  const loat = await Promise.all(
    Array.from({ length: 24 }, () => goi('/api/v1/categories', {}, { gian: false })),
  );
  const lot = loat.filter((r) => r.status === 200).length;
  const chan = loat.filter((r) => r.status === 429).length;
  const loi5 = loat.filter((r) => r.status >= 500 || r.status === 0).length;
  kiem(loi5 === 0, `H1 nổ 24 request cùng lúc: không 5xx/rớt kết nối (${loi5})`);
  kiem(
    lot <= 10 && chan >= 10,
    `H2 lọt ${lot}/24, bị 429 ${chan}/24 (trần chung 10/s)`,
    'lọt > 10 nghĩa là mỗi bản api đếm riêng — throttler không đi qua Redis',
  );
}

// ---------------------------------------------------------------------------
// I + J. Phiên đăng nhập và phân quyền — dùng ba tài khoản của `npm run seed`
// ---------------------------------------------------------------------------
//
// NGÂN SÁCH ĐĂNG NHẬP. `/auth/login` có trần riêng: 3/1s và 10/60s mỗi IP
// (auth.controller.ts). Một lượt chạy tốn 8 lần: E4, E5, năm lần đăng nhập
// đúng (buyer ×3, seller, admin) và I2 sai mật khẩu. Chạy lại trong vòng một
// phút là chạm trần → 429. Đó KHÔNG phải lỗi cụm, nên `dangNhap` báo riêng
// trường hợp đó thay vì để các ca phía sau đỏ dây chuyền.
const MAT_KHAU_SEED = process.env.SUC_KHOE_MAT_KHAU || '123456';

async function dangNhap(email: string, matKhau = MAT_KHAU_SEED): Promise<PhanHoi> {
  // Trần 3/1s: giãn hẳn 400 ms giữa hai lần đăng nhập, chứ 300 ms thì bốn lần
  // liền nhau lọt vào cùng một cửa sổ 1 giây.
  await ngu(400);
  return goi('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: matKhau }),
  });
}
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

async function nhomPhienVaQuyen(): Promise<void> {
  muc('I. Đăng nhập và phiên');
  const mua = await dangNhap('buyer@zoldify.com');
  if (mua.status === 429) {
    bad('I0 /auth/login trả 429', 'chạm trần đăng nhập 10/phút của IP này — chờ 60 giây rồi chạy lại; không phải lỗi cụm');
    return;
  }
  const tkMua: string | undefined = mua.body?.data?.access_token;
  kiem(
    mua.status === 201 && !!tkMua && !!mua.body?.data?.refresh_token && mua.body?.data?.user?.role === 'buyer',
    `I1 buyer đăng nhập → 201, có access + refresh token, role buyer (${mua.status})`,
    mua.status === 401 ? 'tài khoản seed không có — chạy `npm run seed` trên database của cụm' : mua.text.slice(0, 200),
  );
  if (!tkMua) return;

  const sai = await dangNhap('buyer@zoldify.com', 'sai-mat-khau-' + Date.now());
  kiem(sai.status === 401 && !sai.body?.data?.access_token, `I2 sai mật khẩu → 401, không có token (${sai.status})`);

  const hs = await goi('/api/v1/auth/profile', bearer(tkMua));
  kiem(hs.status === 200 && hs.body?.data?.email === 'buyer@zoldify.com', `I3 /auth/profile với token → 200, đúng email (${hs.status})`);
  // Hồ sơ đi thẳng về app. Lộ băm mật khẩu ở đây thì ai mượn được điện thoại
  // là có thứ để bẻ ngoại tuyến.
  const loKhoa = ['password', 'refresh_token', 'refresh_hash', 'token_version'].filter((k) =>
    hs.text.includes(`"${k}"`),
  );
  kiem(loKhoa.length === 0, 'I4 hồ sơ không lộ password / refresh token / token_version', `lộ: ${loKhoa.join(', ')}`);

  // Phiên RIÊNG cho I5–I7: đăng xuất ở đây không được làm chết token mà nhóm
  // J còn dùng. Đây cũng là cách kiểm luôn "đăng xuất máy này không đá máy kia".
  const phien2 = await dangNhap('buyer@zoldify.com');
  const rf: string | undefined = phien2.body?.data?.refresh_token;
  // `iat` của JWT tính theo GIÂY. Lượt chạy đầu (11/11) gọi refresh 300 ms sau
  // đăng nhập: payload trùng, `iat` trùng, nên token "mới" giống từng byte
  // token cũ và I5 báo "chưa xoay" sai. Chờ qua mốc giây rồi mới gọi.
  await ngu(1100);
  const lm = await goi('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: rf }),
  });
  const tkMoi: string | undefined = lm.body?.data?.access_token;
  const rfMoi: string | undefined = lm.body?.data?.refresh_token;
  const dungDuoc = tkMoi ? (await goi('/api/v1/auth/profile', bearer(tkMoi))).status : 0;
  kiem(
    lm.status === 201 && !!tkMoi && rfMoi !== rf && dungDuoc === 200,
    `I5 refresh → cặp token mới, refresh đã xoay, access mới dùng được (${lm.status}/${dungDuoc})`,
  );
  const ra = await goi('/api/v1/auth/logout', { method: 'POST', ...bearer(tkMoi ?? '') });
  const sauRa = await goi('/api/v1/auth/profile', bearer(tkMoi ?? ''));
  const rfSauRa = await goi('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: rfMoi }),
  });
  kiem(
    ra.status === 201 &&
      sauRa.status === 401 &&
      rfSauRa.status >= 400 &&
      rfSauRa.status < 500 &&
      !rfSauRa.body?.data?.access_token,
    `I6 đăng xuất → access cũ 401, refresh cũ bị từ chối (logout ${ra.status} · access ${sauRa.status} · refresh ${rfSauRa.status})`,
    'phiên đã đăng xuất mà token vẫn dùng được nghĩa là thu hồi phiên không có tác dụng',
  );
  const vanSong = await goi('/api/v1/auth/profile', bearer(tkMua));
  kiem(vanSong.status === 200, `I7 đăng xuất phiên này KHÔNG đá phiên khác của cùng người (${vanSong.status})`);

  // -------------------------------------------------------------------------
  muc('J. Phân quyền (buyer · seller · admin)');
  // Token buyer MỚI cho nhóm J. Lượt 11/11 dùng lại token của I1, I7 đá phiên
  // đó, và J1/J3/J6/J7 cùng ra 401 — đỏ dây chuyền che mất câu hỏi thật của
  // nhóm này là "có bị chặn ĐÚNG MÃ 403 không".
  const tkMuaJ: string = (await dangNhap('buyer@zoldify.com')).body?.data?.access_token ?? tkMua;
  const tkBan: string | undefined = (await dangNhap('seller@zoldify.com')).body?.data?.access_token;
  const tkAdmin: string | undefined = (await dangNhap('admin@zoldify.com')).body?.data?.access_token;
  if (!tkBan || !tkAdmin) {
    bad('J0 không đăng nhập được seller/admin seed', 'chạy `npm run seed` trên database của cụm');
    return;
  }
  const ma = async (duong: string, tk: string, init: RequestInit = {}) =>
    (await goi(duong, { ...init, headers: { ...(init.headers as object), Authorization: `Bearer ${tk}` } })).status;

  const j1 = await ma('/api/v1/admin/stats', tkMuaJ);
  kiem(j1 === 403, `J1 buyer → /admin/stats bị chặn 403 (${j1})`);
  const j2 = await ma('/api/v1/admin/users', tkBan);
  kiem(j2 === 403, `J2 seller → /admin/users bị chặn 403 (${j2})`);
  const j3 = await ma('/api/v1/users', tkMuaJ);
  kiem(j3 === 403, `J3 buyer → /users (danh sách mọi người dùng) bị chặn 403 (${j3})`);
  const j4 = await ma('/api/v1/admin/stats', tkAdmin);
  kiem(j4 === 200, `J4 admin → /admin/stats → 200 (${j4})`);
  const dsNd = await goi('/api/v1/users', bearer(tkAdmin));
  kiem(
    dsNd.status === 200 && !dsNd.text.includes('"password"'),
    `J5 admin → /users → 200 và KHÔNG kèm băm mật khẩu (${dsNd.status})`,
  );

  // Leo quyền qua sửa hồ sơ: controller chỉ nhặt 4 trường đã nêu tên, nên
  // `role` phải bị bỏ qua. Body chỉ có `role` → không trường nào được ghi,
  // nên ca này an toàn chạy trên dữ liệu thật kể cả khi nó đỏ.
  await goi('/api/v1/auth/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${tkMuaJ}` },
    body: JSON.stringify({ role: 'admin' }),
  });
  const sauSua = await goi('/api/v1/auth/profile', bearer(tkMuaJ));
  const j6 = await ma('/api/v1/admin/stats', tkMuaJ);
  kiem(
    sauSua.body?.data?.role === 'buyer' && j6 === 403,
    `J6 PATCH /auth/profile {"role":"admin"} không leo quyền (role ${sauSua.body?.data?.role}, /admin ${j6})`,
  );

  // Body rỗng: nếu kiểm chủ sở hữu hỏng thì cũng không có gì bị ghi.
  const sp = (await goi('/api/v1/products?pageSize=1')).body?.data?.result?.[0];
  if (sp?.id) {
    const j7 = await ma(`/api/v1/products/${sp.id}`, tkMuaJ, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    kiem(j7 === 403, `J7 buyer sửa sản phẩm #${sp.id} của người khác → 403 (${j7})`);
  } else skip('J7 sửa sản phẩm người khác', 'không có sản phẩm');

  const tb = (await goi('/api/v1/notifications', bearer(tkMuaJ))).body?.data;
  const idTb = (Array.isArray(tb) ? tb : tb?.result)?.[0]?.id;
  if (idTb) {
    const j8 = await ma(`/api/v1/notifications/${idTb}`, tkBan);
    kiem(j8 === 404 || j8 === 403, `J8 seller đọc thông báo #${idTb} của buyer → 404/403 (${j8})`);
  } else skip('J8 đọc thông báo người khác', 'buyer chưa có thông báo nào');

  const dm = (await goi('/api/v1/orders', bearer(tkMuaJ))).body?.data;
  const idDon = (Array.isArray(dm) ? dm : dm?.result)?.[0]?.id;
  if (idDon) {
    const cuaMua = await goi(`/api/v1/orders/${idDon}`, bearer(tkMuaJ));
    kiem(cuaMua.status === 200, `J9 buyer xem đơn #${idDon} của chính mình → 200 (${cuaMua.status})`);
    // Lỗi H-02 (orders.service.ts findOne): người bán chỉ được thấy tên người
    // nhận, không được thấy email/hồ sơ tài khoản của người mua.
    const cuaBan = await goi(`/api/v1/orders/${idDon}`, bearer(tkBan));
    if (cuaBan.status === 200) {
      kiem(
        !cuaBan.body?.data?.user?.email,
        `J10 seller xem đơn #${idDon}: không thấy email người mua (${cuaBan.body?.data?.user?.email ?? 'ẩn'})`,
      );
    } else skip('J10 seller xem đơn', `seller không phải người bán của đơn #${idDon} (${cuaBan.status})`);
  } else skip('J9/J10 xem đơn', 'buyer chưa có đơn nào');
}

main()
  .catch((e) => bad('lỗi không lường trước trong bộ kiểm', String(e?.stack ?? e)))
  .finally(() => {
    console.log(
      `\n${fail ? '\x1b[31mHỎNG' : '\x1b[32mKHOẺ'}\x1b[0m — ${pass} PASS · ${fail} FAIL · ${boQua} BỎ QUA`,
    );
    process.exit(fail ? 1 : 0);
  });
