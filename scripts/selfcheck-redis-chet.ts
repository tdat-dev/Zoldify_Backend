/**
 * BỘ TỰ KIỂM "REDIS CHẾT THÌ API KHÔNG ĐƯỢC TREO, REDIS SỐNG LẠI THÌ TỰ HỒI PHỤC".
 *
 * Chạy:
 *   docker run -d --name zoldify-test-redis -p 6379:6379 redis:7
 *   npm run check:redis-chet
 *
 * VÌ SAO CÓ BÀI NÀY.
 *
 * Báo cáo `docs/bao-cao/kiem-suc-khoe-2026-11-11.md` (nhánh test/kiem-suc-khoe)
 * dừng Redis của cụm compose và đo được: mọi route chạm cache TREO VÔ THỜI HẠN,
 * `/health` treo theo, Docker đánh dấu cả 3 bản api unhealthy. Ngược hẳn thiết
 * kế ghi trong `health.service.ts` ("Redis chết → 200, `redis: down`").
 *
 * Gốc: `cache.config.ts` gọi `createKeyv(url)` trần. Client node-redis mặc định
 * XẾP HÀNG lệnh lúc mất kết nối để chờ nối lại, nên promise của
 * `cache.get/set` không ném lỗi mà KHÔNG BAO GIỜ KẾT THÚC. Các `try/catch`
 * quanh lệnh cache ở products/auth không cứu được, vì `catch` chỉ chạy khi có
 * lỗi được ném.
 *
 * CÁCH GIẾT REDIS MÀ KHÔNG CẦN QUYỀN ĐIỀU KHIỂN DOCKER.
 *
 * Cache được trỏ vào một proxy TCP dựng ngay trong tiến trình này, proxy chuyển
 * tiếp sang Redis thật. "Redis chết" = proxy đóng cổng và cắt mọi kết nối đang
 * mở — với client, không phân biệt được với `docker stop redis`. "Redis sống
 * lại" = proxy mở lại đúng cổng đó. Nhờ vậy bài chạy được trên CI với service
 * redis có sẵn, không cần `docker` trong job.
 *
 * Mỗi lệnh cache trong bài đều có trần thời gian riêng: bài kiểm một lỗi TREO
 * thì chính nó không được phép treo.
 */

import * as net from 'net';
import { createCache, type Cache } from 'cache-manager';
import { cacheConfig } from '../src/common/cache.config';
import { HealthService } from '../src/ops/health/health.service';

const REDIS_THAT = new URL(
  process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
);

/** Một lệnh cache lúc Redis chết phải xong trong khoảng này (đo cả lỗi lẫn trả về rỗng). */
const TRAN_LENH_MS = 1500;
/** Redis sống lại thì cache phải dùng được lại trong khoảng này. */
const TRAN_HOI_PHUC_MS = 15000;

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};
const tieuDe = (m: string) => console.log(`\x1b[1m— ${m} —\x1b[0m`);
const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Proxy TCP: công tắc sống/chết của Redis ────────────────────────────────
class CongTacRedis {
  private server: net.Server | null = null;
  private readonly socket = new Set<net.Socket>();
  port = 0;

  async song(): Promise<void> {
    if (this.server) return;
    const server = net.createServer((vao) => {
      const ra = net.connect(
        Number(REDIS_THAT.port || 6379),
        REDIS_THAT.hostname,
      );
      for (const s of [vao, ra]) {
        this.socket.add(s);
        s.on('close', () => this.socket.delete(s));
        s.on('error', () => s.destroy());
      }
      vao.pipe(ra).pipe(vao);
      vao.on('close', () => ra.destroy());
      ra.on('close', () => vao.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.port = (server.address() as net.AddressInfo).port;
    this.server = server;
  }

  async chet(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const s of this.socket) s.destroy();
    this.socket.clear();
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  /** Giữ cổng để "Redis chết lúc khởi động" vẫn trỏ được vào một cổng cố định. */
  async giuCong(): Promise<void> {
    await this.song();
    await this.chet();
  }
}

type KetQua<T> =
  | { kieu: 'xong'; ms: number; gia: T }
  | { kieu: 'loi'; ms: number; loi: string }
  | { kieu: 'treo'; ms: number };

async function doLenh<T>(
  lenh: () => Promise<T>,
  tran: number,
): Promise<KetQua<T>> {
  const t0 = Date.now();
  let hen: NodeJS.Timeout | undefined;
  const treo = new Promise<'treo'>((r) => {
    hen = setTimeout(() => r('treo'), tran);
  });
  try {
    const kq = await Promise.race([lenh().then((gia) => ({ gia })), treo]);
    if (kq === 'treo') return { kieu: 'treo', ms: Date.now() - t0 };
    return { kieu: 'xong', ms: Date.now() - t0, gia: kq.gia };
  } catch (e) {
    return { kieu: 'loi', ms: Date.now() - t0, loi: (e as Error).message };
  } finally {
    clearTimeout(hen);
  }
}

async function dungCache(): Promise<{ cache: Cache; stores: unknown[] }> {
  const cfg = await cacheConfig();
  const stores = (cfg.stores as unknown[]) ?? [];
  if (stores.length === 0) {
    throw new Error(
      'cacheConfig() không trả store Redis nào — REDIS_URL không được đọc?',
    );
  }
  // Cùng cách @nestjs/cache-manager dựng CACHE_MANAGER khi store đã là Keyv.
  const cache = createCache({
    stores: stores as never,
    ttl: cfg.ttl as number,
  });
  return { cache, stores };
}

/** Ghi rồi đọc lại một khoá riêng; đúng giá trị nghĩa là đường cache thông. */
async function khuHoi(cache: Cache, tran: number): Promise<boolean> {
  const gia = `${Date.now()}-${Math.random()}`;
  const khoa = `selfcheck:redis-chet:${gia}`;
  const kq = await doLenh(async () => {
    await cache.set(khoa, gia, 10000);
    return cache.get<string>(khoa);
  }, tran);
  return kq.kieu === 'xong' && kq.gia === gia;
}

async function choHoiPhuc(cache: Cache): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < TRAN_HOI_PHUC_MS) {
    if (await khuHoi(cache, TRAN_LENH_MS)) return Date.now() - t0;
    await ngu(250);
  }
  return null;
}

function moTa(kq: KetQua<unknown>): string {
  if (kq.kieu === 'treo') return `TREO quá ${kq.ms} ms`;
  if (kq.kieu === 'loi')
    return `ném lỗi sau ${kq.ms} ms (${kq.loi.slice(0, 60)})`;
  return `trả về ${JSON.stringify(kq.gia)} sau ${kq.ms} ms`;
}

/** Lúc Redis chết, get/set phải KẾT THÚC (trả rỗng hay ném lỗi đều được), không treo. */
async function kiemKhongTreo(cache: Cache, nhan: string): Promise<void> {
  const get = await doLenh(
    () => cache.get('selfcheck:redis-chet:bat-ky'),
    TRAN_LENH_MS,
  );
  get.kieu === 'treo'
    ? bad(`${nhan}: cache.get ${moTa(get)} — request đi qua đây sẽ treo theo`)
    : ok(`${nhan}: cache.get ${moTa(get)}`);
  const set = await doLenh(
    () => cache.set('selfcheck:redis-chet:bat-ky', 1, 1000),
    TRAN_LENH_MS,
  );
  set.kieu === 'treo'
    ? bad(`${nhan}: cache.set ${moTa(set)}`)
    : ok(`${nhan}: cache.set ${moTa(set)}`);
}

async function dong(stores: unknown[]): Promise<void> {
  for (const s of stores) {
    await doLenh(
      async () => (s as { disconnect?: () => Promise<void> }).disconnect?.(),
      2000,
    );
  }
}

// ── 1. Redis chết GIỮA CHỪNG ───────────────────────────────────────────────
async function kiemChetGiuaChung(): Promise<void> {
  tieuDe('1. Redis chết giữa chừng rồi sống lại');
  const cong = new CongTacRedis();
  await cong.song();
  process.env.REDIS_URL = `redis://127.0.0.1:${cong.port}`;
  const { cache, stores } = await dungCache();
  try {
    // Chờ chứ không đọc ngay: client nối ở nền, nên trong vài mili giây đầu
    // lệnh bị từ chối và thành cache miss — đúng chủ ý, không phải lỗi.
    (await choHoiPhuc(cache)) !== null
      ? ok('Redis sống: ghi rồi đọc lại đúng giá trị')
      : bad(
          'Redis sống mà ghi/đọc không khớp — bài kiểm không đo được gì phía dưới',
        );

    await cong.chet();
    await ngu(300);
    await kiemKhongTreo(cache, 'Redis vừa chết');
    // Lần thứ hai sau vài giây: client lúc này đang trong vòng nối lại.
    await ngu(2000);
    await kiemKhongTreo(cache, 'Redis chết 2 s');

    await cong.song();
    const ms = await choHoiPhuc(cache);
    ms === null
      ? bad(
          `Redis sống lại mà quá ${TRAN_HOI_PHUC_MS} ms cache vẫn chưa dùng được — không tự hồi phục`,
        )
      : ok(`Redis sống lại: cache tự dùng được lại sau ${ms} ms`);
  } finally {
    await dong(stores);
    await cong.chet();
  }
}

// ── 2. Redis chết NGAY LÚC KHỞI ĐỘNG ───────────────────────────────────────
async function kiemChetLucKhoiDong(): Promise<void> {
  tieuDe('2. Khởi động lúc Redis đang chết, rồi Redis lên');
  const cong = new CongTacRedis();
  await cong.giuCong();
  process.env.REDIS_URL = `redis://127.0.0.1:${cong.port}`;
  const dung = await doLenh(() => dungCache(), 5000);
  if (dung.kieu !== 'xong') {
    bad(
      `dựng cache lúc Redis chết: ${moTa(dung)} — app sẽ không khởi động được`,
    );
    return;
  }
  ok(`dựng cache lúc Redis chết: xong sau ${dung.ms} ms, không chặn khởi động`);
  const { cache, stores } = dung.gia;
  try {
    await kiemKhongTreo(cache, 'Redis chưa lên');
    await cong.song();
    const ms = await choHoiPhuc(cache);
    ms === null
      ? bad(`Redis lên mà quá ${TRAN_HOI_PHUC_MS} ms cache vẫn chưa dùng được`)
      : ok(`Redis lên sau khi app đã chạy: cache tự dùng được sau ${ms} ms`);
  } finally {
    await dong(stores);
    await cong.chet();
  }
}

// ── 3. /health có trần thời gian kể cả khi cache treo kiểu khác ────────────
async function kiemHealthCoTran(): Promise<void> {
  tieuDe('3. /health không được treo theo cache');
  // Cache treo hẳn (promise không bao giờ kết thúc). Đây là kiểu hỏng mà mục 1
  // đã chặn ở tầng client, nhưng còn những cách treo client không thấy được
  // (mạng rớt gói mà không có RST). /health là thứ Docker dựa vào để quyết
  // giết container, nên nó phải tự có trần, không được trông vào tầng dưới.
  const cacheTreo = {
    set: () => new Promise(() => undefined),
    get: () => new Promise(() => undefined),
  };
  const dbSong = { query: async () => [{ 1: 1 }] };
  process.env.REDIS_URL = 'redis://khong-quan-trong:6379';
  const health = new HealthService(dbSong as never, cacheTreo as never);
  const kq = await doLenh(() => health.kiem(), 4000);
  if (kq.kieu !== 'xong') {
    bad(`/health khi cache treo: ${moTa(kq)} — Docker sẽ đánh dấu unhealthy`);
    return;
  }
  kq.gia.http === 200 && kq.gia.redis === 'down'
    ? ok(
        `/health khi cache treo: ${kq.gia.http}, redis=${kq.gia.redis}, sau ${kq.ms} ms`,
      )
    : bad(
        `/health khi cache treo: http=${kq.gia.http}, redis=${kq.gia.redis} (muốn 200 + down)`,
      );
}

async function main(): Promise<void> {
  // Không có Redis thật thì không có gì để đo — đỏ rõ ràng thay vì xanh giả.
  const thu = await doLenh(
    () =>
      new Promise<void>((resolve, reject) => {
        const s = net.connect(
          Number(REDIS_THAT.port || 6379),
          REDIS_THAT.hostname,
        );
        s.once('connect', () => {
          s.destroy();
          resolve();
        });
        s.once('error', reject);
      }),
    2000,
  );
  if (thu.kieu !== 'xong') {
    console.log(
      `\x1b[31mKhông nối được Redis ở ${REDIS_THAT.host}.\x1b[0m Dựng: docker run -d --name zoldify-test-redis -p 6379:6379 redis:7`,
    );
    process.exit(1);
  }

  await kiemChetGiuaChung();
  await kiemChetLucKhoiDong();
  await kiemHealthCoTran();

  console.log(
    failures === 0
      ? '\n\x1b[32mXANH\x1b[0m — Redis chết không làm treo cache, sống lại thì tự hồi phục.'
      : `\n\x1b[31mĐỎ\x1b[0m — ${failures} ca hỏng.`,
  );
  // Thoát cứng: client Redis còn treo (đúng lỗi đang đo) sẽ giữ event loop sống.
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
