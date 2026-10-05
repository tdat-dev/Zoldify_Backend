/**
 * BỘ TỰ KIỂM HÌNH DẠNG CỤM (task #6 bảng phân công) — viết TEST TRƯỚC.
 *
 * Chạy:
 *   npm run check:compose        (KHÔNG cần Docker — đọc file, không dựng gì)
 *
 * VÌ SAO TASK #6 TỒN TẠI, NÓI BẰNG SỐ ĐO CHỨ KHÔNG BẰNG CẢM GIÁC.
 *
 * `docs/system-design/load-test.md` đo trên chính hệ này: CPU chạm ~100% một
 * luồng ngay từ mức 10 người bấm cùng lúc ở gần như mọi route. Từ đó trở đi
 * tăng tải chỉ làm dài hàng đợi — cột RPS đứng yên (964 → 947 → 949 rps) trong
 * khi p95 gấp đôi mỗi lần số song song gấp đôi (13.8 → 59 → 118 ms). Node chỉ
 * có một luồng JS, nên **thêm nhân cho một tiến trình không đổi gì**; chỉ thêm
 * tiến trình mới đổi. Đó là lý do duy nhất của ô `api x3` trong sơ đồ triển khai.
 *
 * VÌ SAO KIỂM BẰNG FILE CHỨ KHÔNG DỰNG CỤM THẬT.
 *
 * Thứ bài này gác là **hình dạng cụm**, mà hình dạng cụm nằm trong
 * `docker-compose.yml` + `Caddyfile` chứ không nằm trong tiến trình đang chạy.
 * Dựng cụm thật chỉ trả lời được "cụm hôm nay thế nào", trong khi câu cần gác
 * là "cụm lần deploy sau thế nào". Và bài kiểm không cần Docker thì CI chạy
 * được ở mọi job, không phải chỉ job có dịch vụ nền.
 *
 * Bù lại phần yếu của cách đọc file: nếu máy có Docker, mục 6 đối chiếu thêm
 * bằng `docker compose config` — thứ compose THẬT SỰ hiểu — để bắt trường hợp
 * file đọc được bằng js-yaml mà compose lại từ chối.
 *
 * BA CA ĐỐI CHỨNG ở mục 1 là những bất biến ĐÃ đúng từ trước khi có task #6.
 * Chúng phải PASS ngay lần chạy đầu tiên. Không có chúng thì "cụm sai hết" và
 * "bộ kiểm này hỏng" in ra giống hệt nhau — đúng cái bẫy R1/R4 mà
 * docs/BAN-GIAO.md kể: một bài kiểm không chuyển được đỏ→xanh thì vô dụng.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as yaml from 'js-yaml';

const GOC = path.resolve(__dirname, '..');

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string, vaLam?: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
  if (vaLam) console.log(`          \x1b[33m↳ ${vaLam}\x1b[0m`);
};
const kiem = (dieuKien: boolean, ten: string, vaLam?: string) =>
  dieuKien ? ok(ten) : bad(ten, vaLam);

/**
 * Thay `${BIEN:-mặc định}` / `${BIEN}` / `${BIEN:?lời nhắn}` giống compose.
 *
 * VÌ SAO PHẢI TỰ LÀM: bài kiểm này cố ý chạy được khi KHÔNG có Docker, nên
 * không mượn được `docker compose config` để nội suy hộ. Chỉ làm đúng ba dạng
 * compose dùng trong file này; dạng lạ thì trả nguyên chuỗi để mục 6 bắt, chứ
 * không đoán.
 */
function noiSuy(s: string): string {
  return s.replace(
    /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*)|:\?[^}]*)?\}/g,
    (_tron, ten: string, macDinh?: string) => process.env[ten] ?? macDinh ?? '',
  );
}

/**
 * "512m" → 512·1024·1024. Trả null khi không hiểu, để nơi gọi báo FAIL — chứ
 * không âm thầm thành 0, vì 0 sẽ làm phép cộng ngân sách RAM ở mục 5 luôn lọt.
 */
function doiRaByte(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)\s*([kmgKMG])?[bB]?$/.exec(noiSuy(v).trim());
  if (!m) return null;
  const so = parseFloat(m[1]);
  const heSo = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[(m[2] ?? '').toLowerCase()];
  return heSo ? so * heSo : so;
}

const doiRaMB = (b: number) => Math.round(b / 1024 / 1024);

interface Dich {
  image?: string;
  ports?: unknown[];
  volumes?: string[];
  environment?: Record<string, string> | string[];
  healthcheck?: { test?: unknown; disable?: boolean };
  mem_limit?: string | number;
  deploy?: { replicas?: number };
  [k: string]: unknown;
}

const compose = yaml.load(
  fs.readFileSync(path.join(GOC, 'docker-compose.yml'), 'utf8'),
) as { services: Record<string, Dich> };

const S = compose.services ?? {};
const co = (ten: string) => Object.prototype.hasOwnProperty.call(S, ten);

/** `environment` viết được cả hai kiểu (map và mảng "K=V"); gộp về một kiểu. */
function env(d: Dich | undefined, khoa: string): string | undefined {
  if (!d?.environment) return undefined;
  if (Array.isArray(d.environment)) {
    const hit = d.environment.find((x) => x.startsWith(`${khoa}=`));
    return hit?.slice(khoa.length + 1);
  }
  return d.environment[khoa];
}

/**
 * Số bản compose sẽ dựng. Không khai `deploy.replicas` nghĩa là 1.
 *
 * Phải nội suy chứ không đọc thẳng: `replicas: ${API_REPLICAS:-3}` là một
 * CHUỖI dưới mắt js-yaml, không phải số. Bản đầu của hàm này chỉ nhận `number`
 * nên nó đọc ra 1 và mục "api ≥2 bản" đỏ trong khi compose đã khai 3 — bài
 * kiểm đo sai chính thứ nó gác.
 *
 * Trả NaN khi không hiểu, để mục gọi nó báo đỏ; im lặng rơi về 1 thì một biến
 * gõ sai sẽ thành "cụm chạy một bản" mà không ai được báo.
 */
const soBan = (d: Dich | undefined): number => {
  const r = d?.deploy?.replicas;
  if (r === undefined || r === null) return 1;
  if (typeof r === 'number') return r;
  const n = Number.parseInt(noiSuy(String(r)).trim(), 10);
  return Number.isFinite(n) ? n : NaN;
};

/** Cổng HOST một dịch vụ publish, sau nội suy. `'${API_PORT:-3000}:3000'` → `3000`. */
function congHost(d: Dich | undefined): string[] {
  return (d?.ports ?? []).map((p) => {
    const s = noiSuy(
      String(typeof p === 'object' ? (p as { published?: unknown }).published : p),
    );
    const phan = s.split(':');
    return phan.length > 1 ? phan[phan.length - 2] : s;
  });
}

console.log(
  '\n\x1b[1m── Hình dạng cụm: caddy · nhiều bản api · mem_limit ──\x1b[0m\n',
);

// ─── 1. Ca đối chứng: phải XANH ngay lần chạy đầu ────────────────────────────
console.log('\x1b[2m1) Ca đối chứng — đỏ ở đây nghĩa là bộ kiểm hỏng\x1b[0m');
kiem(
  co('mysql') && co('redis') && co('api'),
  'mysql · redis · api đều có trong compose',
);
kiem(
  Array.isArray(S.mysql?.healthcheck?.test),
  'mysql có healthcheck (migrate chờ đúng cái này)',
);
kiem(
  !!S.api?.image && S.api?.image === S.worker?.image,
  'api và worker DÙNG CHUNG một image (không chạy lệch phiên bản mã)',
);

// ─── 2. Caddy ───────────────────────────────────────────────────────────────
console.log('\n\x1b[2m2) Caddy — TLS và đường vào duy nhất\x1b[0m');
const caddy = S.caddy;
kiem(!!caddy, 'có dịch vụ `caddy`', 'thêm service caddy vào docker-compose.yml');

kiem(
  congHost(caddy).length >= 2,
  'caddy publish hai cổng (HTTP cho ACME, HTTPS để phục vụ)',
  'thiếu cổng 80 thì Let’s Encrypt không xác thực nổi bằng HTTP-01',
);

const volCaddy = (caddy?.volumes ?? []).join(' ');
kiem(
  /:\/data\b/.test(volCaddy),
  'caddy có volume BỀN cho /data (kho chứng chỉ)',
  'mất /data là mỗi lần tạo container lại xin cert mới → Let’s Encrypt chặn ở 5 cert/tuần/domain',
);
kiem(/:\/config\b/.test(volCaddy), 'caddy có volume cho /config');

const coCaddyfile = fs.existsSync(path.join(GOC, 'Caddyfile'));
kiem(
  coCaddyfile,
  'file `Caddyfile` có trong repo',
  'không có thì image caddy chạy cấu hình mặc định và cụm im lặng phục vụ sai',
);

if (coCaddyfile) {
  const cf = fs.readFileSync(path.join(GOC, 'Caddyfile'), 'utf8');

  // Hai dạng khai upstream, và chúng KHÔNG tương đương khi có nhiều bản api.
  const tinh = /reverse_proxy\s+[^\n{]*\bapi:3000\b/.test(cf);
  const dong =
    /dynamic\s+a\s*\{[^}]*\bname\s+api\b[^}]*\bport\s+3000\b[^}]*\}/s.test(cf) ||
    /dynamic\s+a\s+api\s+3000\b/.test(cf);

  kiem(
    tinh || dong,
    'Caddyfile trỏ upstream tới dịch vụ `api` cổng 3000',
    '`localhost` bên trong container caddy là chính nó, không phải api',
  );

  // VÌ SAO DẠNG TĨNH LÀ LỖI KHI CHẠY NHIỀU BẢN — và vì sao phải gác bằng máy.
  //
  // `reverse_proxy api:3000` làm caddy giải tên MỘT LẦN lúc khởi động rồi giữ
  // đúng một IP. Compose dựng ba bản, DNS của Docker trả ba bản ghi A, nhưng
  // caddy đã chốt bản đầu: hai bản kia ngồi không, bản thứ nhất nghẽn y như
  // khi chưa nhân bản. Không có lỗi nào hiện ra — `docker compose ps` vẫn ba
  // dòng healthy, log vẫn sạch — chỉ có số đo không nhúc nhích. Đây là kiểu
  // hỏng đắt nhất của task #6, nên nó phải là một mục kiểm chứ không phải một
  // dòng ghi nhớ trong tài liệu.
  kiem(
    soBan(S.api) < 2 || dong,
    'upstream khai bằng `dynamic a` (hỏi lại DNS, thấy đủ ba bản)',
    'dạng tĩnh `api:3000` chốt một IP lúc khởi động — nhân bản xong mà tải vẫn dồn vào một bản',
  );
}

// ─── 3. Nhiều bản api ───────────────────────────────────────────────────────
console.log(
  '\n\x1b[2m3) Nhiều tiến trình api — thứ duy nhất đẩy trần lên\x1b[0m',
);
const banApi = soBan(S.api);
kiem(
  banApi >= 2,
  `api chạy ≥2 bản (đang khai ${banApi})`,
  'load-test.md: một tiến trình Node đụng trần một luồng JS ngay từ 10 người bấm cùng lúc',
);
kiem(
  congHost(S.api).length === 0,
  'api KHÔNG publish cổng ra host',
  `${banApi} bản cùng publish một cổng host là đụng cổng — caddy phải là đường vào duy nhất`,
);
kiem(
  banApi < 2 || !!env(S.api, 'REDIS_URL'),
  'api có REDIS_URL khi chạy nhiều bản',
  'thiếu Redis thì throttler/socket/cache rơi về RAM từng tiến trình: rate limit đếm sai, socket rơi',
);

// ─── 4. Worker phải đúng MỘT bản ────────────────────────────────────────────
console.log('\n\x1b[2m4) Worker — đúng một bản, đây là chuyện tiền\x1b[0m');
kiem(
  soBan(S.worker) === 1,
  `worker đúng 1 bản (đang khai ${soBan(S.worker)})`,
  '`OrdersService.cancelExpired` đọc đơn NGOÀI transaction, không khoá dòng: hai lượt quét chồng nhau là hoàn tiền hai lần',
);

// ─── 5. mem_limit và ngân sách RAM ──────────────────────────────────────────
console.log(
  '\n\x1b[2m5) mem_limit — không có trần thì một rò rỉ kéo sập cả VPS\x1b[0m',
);
const NGAN_SACH = doiRaByte(process.env.VPS_MEM_BUDGET ?? '4g')!;
let tong = 0;
let duHet = true;

for (const [ten, d] of Object.entries(S)) {
  const b = doiRaByte(d.mem_limit);
  if (b === null) {
    duHet = false;
    bad(
      `\`${ten}\` chưa có mem_limit`,
      'không trần thì tiến trình rò rỉ ăn hết RAM và OOM-killer của Linux chọn nạn nhân — thường là mysql',
    );
    continue;
  }

  // `restart: 'no'` = chạy một lần rồi thoát (chỉ có `migrate`). KHÔNG cộng vào
  // đỉnh: `api` và `worker` khai `service_completed_successfully` trên nó, nên
  // theo đúng định nghĩa chúng không bao giờ chạy cùng lúc với nó. Cộng vào là
  // tính dư 256M và ép hạ một thứ khác xuống mà không có lý do thật.
  const chayMotLan = String(d.restart) === 'no';

  // Cộng theo SỐ BẢN: 3 bản api là 3 lần 512M, không phải 512M.
  if (!chayMotLan) tong += b * soBan(d);

  ok(
    `\`${ten}\` mem_limit ${doiRaMB(b)}M × ${soBan(d)} bản` +
      (chayMotLan ? ' \x1b[2m(chạy một lần rồi thoát — ngoài đỉnh)\x1b[0m' : ''),
  );
}

if (duHet) {
  kiem(
    tong <= NGAN_SACH,
    `tổng trần RAM ${doiRaMB(tong)}M ≤ ngân sách ${doiRaMB(NGAN_SACH)}M`,
    'đặt VPS_MEM_BUDGET đúng RAM máy thật, hoặc hạ API_REPLICAS — vượt là OOM-kill',
  );
}

// ─── 6. Đối chiếu với compose THẬT (bỏ qua khi máy không có Docker) ─────────
console.log(
  '\n\x1b[2m6) Đối chiếu: compose thật có đọc nổi file này không\x1b[0m',
);
/**
 * HỎI DOCKER CÓ Ở ĐÂY KHÔNG BẰNG MỘT CÂU RIÊNG, KHÔNG ĐOÁN QUA LỜI BÁO LỖI.
 *
 * Bản đầu của mục này bắt lỗi rồi dò chữ `docker|not found|...` trong đó để
 * đoán xem máy có Docker không. Chạy thử ngay lần đầu là dính: máy này CÓ
 * Docker chạy, nhưng chưa có file `.env`, nên compose trả
 * "env file ... .env not found" — chuỗi đó khớp `not found`, và mục này in
 * "máy không gọi được Docker" rồi bỏ qua trong im lặng. Đúng cái mục tự bật
 * thành xanh mà comment ở đầu file đang cấm.
 */
const coDocker = (() => {
  try {
    cp.execSync('docker compose version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

const boQua = (lyDo: string) =>
  console.log(`  \x1b[33m– BỎ QUA\x1b[0m  ${lyDo}; năm mục trên đã đủ gác hình dạng`);

if (!coDocker) {
  boQua('máy này không gọi được Docker');
} else if (!fs.existsSync(path.join(GOC, '.env'))) {
  // KHÔNG nới `env_file: .env` thành tuỳ chọn để mục này chạy được.
  //
  // Thiếu `.env` thì compose từ chối dựng — và đó là một CỬA CHẶN cố ý: nó
  // đứng giữa một lần deploy và một cụm chạy với secret rỗng. Sửa compose cho
  // vừa lòng bộ tự kiểm là đổi hành vi production để bài kiểm dễ xanh, tức là
  // lấy cái đuôi vẫy con chó. Ở đây nói thẳng lý do bỏ qua và để nguyên cửa.
  boQua('máy này chưa có `.env` (bị gitignore) nên compose từ chối trước khi đọc tới cú pháp');
} else {
  try {
    cp.execSync('docker compose config -q', {
      cwd: GOC,
      stdio: 'pipe',
      // DB_PASSWORD viết bằng cú pháp `:?` nên compose DỪNG khi nó trống. Ở
      // đây chỉ kiểm cú pháp, không dựng gì, nên mồi một giá trị cho qua cửa đó.
      env: { ...process.env, DB_PASSWORD: process.env.DB_PASSWORD || 'kiem-tra' },
    });
    ok('`docker compose config` phân tích được file (không lỗi cú pháp)');
  } catch (e) {
    const loi = String((e as { stderr?: Buffer }).stderr ?? e).trim();
    bad('`docker compose config` từ chối file', loi.split('\n')[0]);
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32m═══ TẤT CẢ PASS ✓ ═══\x1b[0m\n'
    : `\n\x1b[31m═══ ${failures} MỤC FAIL ═══\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
