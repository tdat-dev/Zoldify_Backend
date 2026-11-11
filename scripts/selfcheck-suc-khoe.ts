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
  const cors = await goi('/api/v1/categories', { headers: { Origin: 'https://ke-gian.example' } });
  kiem(
    cors.headers.get('access-control-allow-origin') !== 'https://ke-gian.example' &&
      cors.headers.get('access-control-allow-origin') !== '*',
    `F6 CORS không mở cho origin lạ (${cors.headers.get('access-control-allow-origin') ?? 'không có header'})`,
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

main()
  .catch((e) => bad('lỗi không lường trước trong bộ kiểm', String(e?.stack ?? e)))
  .finally(() => {
    console.log(
      `\n${fail ? '\x1b[31mHỎNG' : '\x1b[32mKHOẺ'}\x1b[0m — ${pass} PASS · ${fail} FAIL · ${boQua} BỎ QUA`,
    );
    process.exit(fail ? 1 : 0);
  });
