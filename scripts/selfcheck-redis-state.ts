/**
 * BỘ TỰ KIỂM "BỎ TRẠNG THÁI TRONG RAM TIẾN TRÌNH" (task #5) — viết TEST TRƯỚC.
 *
 * Chạy:
 *   docker run -d --name zoldify-test-redis -p 6380:6379 redis:7
 *   npm run check:redis
 *
 * VÌ SAO BÀI TEST NÀY PHẢI CHẠY THẬT, KHÔNG ĐƯỢC CHỈ ĐỌC FILE.
 *
 * Cả ba lỗi mà task #5 sửa đều có chung một tính chất: **chúng không tồn tại
 * khi chạy một bản api.** Trên máy dev, mọi thứ đúng. Trên CI với một tiến
 * trình, mọi thứ đúng. Chúng chỉ xuất hiện khi có bản api thứ hai, và lúc đó
 * là production.
 *
 *   1. ThrottlerModule không khai `storage` → mỗi bản đếm riêng. Đặt giới hạn
 *      10 req/s mà chạy 3 bản thì giới hạn thật là 30 — và không ai biết, vì
 *      không có lỗi nào được ném ra. Rate limit vẫn "hoạt động".
 *   2. `server.emit()` không có adapter chung → tin nhắn chỉ tới client nối vào
 *      đúng bản đó. Hai người đang chat với nhau, mỗi người nối một bản, không
 *      ai thấy tin của ai. Không có lỗi, chỉ là im lặng.
 *   3. `onlineUsers` Map trong RAM → mỗi bản thấy một danh sách online khác
 *      nhau, và không bản nào đúng.
 *
 * Đọc file chỉ chứng minh được là mã CÓ GỌI Redis. Nó không chứng minh được
 * hai tiến trình thật sự nhìn thấy nhau. Nên bài test này DỰNG HAI SERVER
 * socket.io thật trên hai cổng khác nhau, nối một client vào server thứ hai,
 * rồi phát tin từ server thứ nhất. Nếu client nhận được thì cụm nói chuyện
 * được với nhau; nếu không thì mọi lập luận trong code đều vô nghĩa.
 *
 * Tương tự với throttler: hai instance storage riêng biệt, tăng cùng một khoá,
 * và đòi cái thứ hai phải thấy số của cái thứ nhất.
 *
 * Ranh giới: bài test không dựng cả NestJS app. Nó kiểm phần hạ tầng — adapter
 * và storage — thật sự chia sẻ trạng thái qua Redis, cộng với phần đọc file để
 * chắc rằng app.module và gateway CÓ nối vào đúng thứ đã chứng minh ở trên.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const APP_MODULE = path.join(ROOT, 'src', 'app.module.ts');
const GATEWAY = path.join(ROOT, 'src', 'messaging', 'chat', 'chat.gateway.ts');
const CI = path.join(ROOT, '.github', 'workflows', 'ci.yml');

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380';

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};

function doc(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

/** Bỏ dòng comment để không khớp nhầm vào lời giải thích thay vì vào hành vi. */
const bodyOnly = (s: string) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

/** Chờ một sự kiện, hoặc bỏ cuộc sau `ms` — để bài test không treo mãi. */
function doiSuKien<T>(
  dangKy: (xong: (v: T) => void) => void,
  ms: number,
  moTa: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`quá ${ms}ms mà ${moTa}`)),
      ms,
    );
    dangKy((v) => {
      clearTimeout(t);
      resolve(v);
    });
  });
}

// ── Phần 1: hợp đồng đọc từ file ───────────────────────────────────────────
function kiemTinh(): void {
  console.log('\x1b[1m— 1. Gói phụ thuộc —\x1b[0m');
  const pkg = JSON.parse(doc(PKG) || '{}') as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  for (const g of [
    'ioredis',
    '@socket.io/redis-adapter',
    '@nest-lab/throttler-storage-redis',
  ]) {
    deps[g] ? ok(`${g} ${deps[g]}`) : bad(`THIẾU gói ${g}`);
  }

  // Ghim ở dòng 5.x có chủ đích — lý do đầy đủ trong commit thêm gói.
  const io = deps['ioredis'] ?? '';
  /^\^?5\./.test(io)
    ? ok('ioredis ghim ở dòng 5.x (bản đã được thử cùng throttler storage)')
    : bad(`ioredis đang là "${io}" — dòng 6.x chưa từng được thử với @nest-lab/throttler-storage-redis`);

  console.log('\n\x1b[1m— 2. Throttler dùng chung bộ đếm —\x1b[0m');
  const app = bodyOnly(doc(APP_MODULE));
  /ThrottlerStorageRedis/.test(app)
    ? ok('app.module khai storage Redis cho throttler')
    : bad('ThrottlerModule KHÔNG khai storage — mỗi bản api sẽ đếm riêng');
  // Phải buộc `forRootAsync` vào ĐÚNG ThrottlerModule.
  //
  // Bản đầu của kiểm này chỉ tìm chuỗi `forRootAsync` trong cả file và báo
  // PASS — trong khi ThrottlerModule vẫn là `forRoot` tĩnh. Chuỗi ấy có thật,
  // nhưng là của TypeOrmModule và MailerModule. Một PASS giả còn tệ hơn một
  // FAIL: FAIL thì có người đi sửa, PASS giả thì không ai nhìn lại nữa.
  /ThrottlerModule\.forRootAsync/.test(app)
    ? ok('ThrottlerModule.forRootAsync (đọc được REDIS_URL lúc chạy)')
    : bad('ThrottlerModule vẫn là forRoot tĩnh — không đọc được cấu hình');

  console.log('\n\x1b[1m— 3. Socket dùng chung adapter —\x1b[0m');
  const gate = bodyOnly(doc(GATEWAY));

  // Đây là kiểm quan trọng nhất của phần đọc file: cái Map cũ phải BIẾN MẤT,
  // không phải "vẫn còn nhưng có thêm Redis bên cạnh". Hai nguồn sự thật cho
  // cùng một câu hỏi thì sớm muộn chúng lệch nhau.
  /private\s+onlineUsers/.test(gate)
    ? bad('chat.gateway VẪN giữ Map onlineUsers trong RAM — mỗi bản api thấy một danh sách khác nhau')
    : ok('chat.gateway không còn Map onlineUsers trong RAM');

  /fetchSockets/.test(gate)
    ? ok('presence hỏi cả cụm qua fetchSockets()')
    : bad('không thấy fetchSockets() — presence vẫn cục bộ');

  // Adapter phải được gắn ở tầng khởi động, không phải trong gateway.
  const coAdapter = spawnSync(
    'git',
    ['grep', '-l', 'createAdapter', '--', 'src/'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const noiGan = (coAdapter.stdout ?? '').trim();
  noiGan
    ? ok(`adapter Redis được gắn ở: ${noiGan.split('\n').join(', ')}`)
    : bad('không nơi nào gọi createAdapter — socket vẫn chỉ nói chuyện trong một tiến trình');

  console.log('\n\x1b[1m— 4. CI có Redis để chạy bài test này —\x1b[0m');
  const ci = doc(CI);
  /^\s{6}redis:/m.test(ci)
    ? ok('ci.yml khai service redis')
    : bad('ci.yml THIẾU service redis — bài test này sẽ đỏ trên runner');
  /TEST_REDIS_URL/.test(ci)
    ? ok('ci.yml truyền TEST_REDIS_URL')
    : bad('ci.yml không truyền TEST_REDIS_URL');
}

// ── Phần 2: chạy thật, hai tiến trình logic nhìn thấy nhau ─────────────────
async function kiemChay(): Promise<void> {
  console.log('\n\x1b[1m— 5. CHẠY THẬT: hai server socket.io có thấy nhau —\x1b[0m');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis = require('ioredis');
  const { Server } = require('socket.io');
  const { createAdapter } = require('@socket.io/redis-adapter');
  const { io: ioClient } = require('socket.io-client');
  const {
    ThrottlerStorageRedisService,
  } = require('@nest-lab/throttler-storage-redis');

  const doiTuongCanDong: Array<() => void> = [];
  const dong = () => doiTuongCanDong.forEach((f) => {
    try {
      f();
    } catch {
      /* đang dọn, lỗi ở đây không đáng làm hỏng kết quả */
    }
  });

  const moKetNoi = (ten: string) => {
    const r = new IORedis(REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      retryStrategy: () => null, // không thử lại mãi: thà đỏ nhanh còn hơn treo
    });
    r.on('error', () => { /* nuốt ở đây, lỗi thật lộ ra ở lệnh bên dưới */ });
    doiTuongCanDong.push(() => r.disconnect());
    return r;
  };

  let probe: any;
  try {
    probe = moKetNoi('probe');
    await probe.ping();
    ok(`nối được Redis ở ${REDIS_URL}`);
  } catch (e) {
    bad(
      `KHÔNG nối được Redis ở ${REDIS_URL} (${(e as Error).message}). ` +
        `Dựng bằng: docker run -d --name zoldify-test-redis -p 6380:6379 redis:7`,
    );
    dong();
    return;
  }

  // Hai "bản api" giả lập: hai server socket.io độc lập, mỗi cái có cặp
  // pub/sub RIÊNG. Phải là hai kết nối chứ không một: một client đang ở chế độ
  // subscribe thì không chạy được lệnh nào khác, dùng chung là hỏng câm.
  const mkServer = (port: number) => {
    const pub = moKetNoi(`pub${port}`);
    const sub = pub.duplicate();
    doiTuongCanDong.push(() => sub.disconnect());
    const srv = new Server(port, { cors: { origin: '*' } });
    srv.adapter(createAdapter(pub, sub));
    doiTuongCanDong.push(() => srv.close());
    return srv;
  };

  try {
    const A = mkServer(3901);
    const B = mkServer(3902);

    // Client nối vào B, KHÔNG nối vào A.
    const cli = ioClient('http://127.0.0.1:3902', {
      transports: ['websocket'],
      reconnection: false,
    });
    doiTuongCanDong.push(() => cli.close());

    await doiSuKien<void>(
      (xong) => cli.on('connect', () => xong()),
      5000,
      'client không nối được vào server B',
    );
    ok('client nối vào server B (cổng 3902)');

    // Phép thử chính: PHÁT TỪ A, NHẬN Ở B.
    const nhan = doiSuKien<{ tu: string }>(
      (xong) => cli.on('tin-tu-cum-khac', (d: { tu: string }) => xong(d)),
      5000,
      'client nối vào B KHÔNG nhận được tin phát từ A',
    );
    A.emit('tin-tu-cum-khac', { tu: 'server-A' });
    const goi = await nhan;
    goi.tu === 'server-A'
      ? ok('tin phát từ server A tới được client đang nối server B')
      : bad(`nhận được tin nhưng nội dung lạ: ${JSON.stringify(goi)}`);

    // Presence: A phải đếm được socket đang nằm ở B.
    const socketsToanCum = await A.fetchSockets();
    socketsToanCum.length === 1
      ? ok('fetchSockets() từ A thấy socket đang nối ở B — presence đúng toàn cụm')
      : bad(
          `fetchSockets() từ A thấy ${socketsToanCum.length} socket, đáng lẽ 1. ` +
            `Presence sẽ sai khi chạy nhiều bản api`,
        );
  } catch (e) {
    bad((e as Error).message);
  }

  // ── Throttler: hai storage riêng, một bộ đếm ──────────────────────────────
  console.log('\n\x1b[1m— 6. CHẠY THẬT: hai storage throttler dùng chung bộ đếm —\x1b[0m');
  try {
    const s1 = new ThrottlerStorageRedisService(moKetNoi('thr1'));
    const s2 = new ThrottlerStorageRedisService(moKetNoi('thr2'));
    const khoa = `selfcheck-throttler-${Date.now()}`;

    const r1 = await s1.increment(khoa, 60, 100, 0, 'test');
    const r2 = await s2.increment(khoa, 60, 100, 0, 'test');

    r1.totalHits === 1
      ? ok('storage #1 đếm lần đầu = 1')
      : bad(`storage #1 trả totalHits=${r1.totalHits}, đáng lẽ 1`);

    r2.totalHits === 2
      ? ok('storage #2 thấy số của #1 — hai bản api dùng CHUNG bộ đếm')
      : bad(
          `storage #2 trả totalHits=${r2.totalHits}, đáng lẽ 2. ` +
            `Mỗi bản api đang đếm riêng — giới hạn thật sẽ lỏng gấp N lần`,
        );

    await probe.del(khoa);
  } catch (e) {
    bad(`throttler storage lỗi: ${(e as Error).message}`);
  }

  // ── Redis chết KHÔNG được kéo sập API ────────────────────────────────────
  //
  // Kiểm này thêm sau, và đó là một thiếu sót đáng ghi lại: pre-mortem đã nêu
  // R1 "throttler gọi storage ở MỌI request, storage ném lỗi là mọi request
  // 500", nhưng bài test viết trước lại không kiểm nó. Nghĩa là bài test có
  // thể xanh trọn vẹn trong khi rủi ro nghiêm trọng nhất của cả task vẫn còn
  // nguyên. Dự đoán được rủi ro chưa đủ — phải mã hoá nó thành phép đo.
  console.log('\n\x1b[1m— 7. CHẠY THẬT: Redis chết thì request vẫn đi qua —\x1b[0m');
  try {
    const {
      ThrottlerStorageFailOpen,
    } = require('../src/common/throttler-fail-open');
    const storageHong = {
      increment: () => Promise.reject(new Error('Redis giả vờ chết')),
    };
    const boc = new ThrottlerStorageFailOpen(storageHong);
    const r = await boc.increment('bat-ky', 1000, 10, 0, 'short');
    r.totalHits === 0 && r.isBlocked === false
      ? ok('storage ném lỗi → lớp bọc cho request đi qua, không ném lên guard')
      : bad(
          `lớp bọc trả ${JSON.stringify(r)} — guard sẽ chặn hoặc ném, tức là ` +
            `Redis chết sẽ làm mọi request 500`,
        );
  } catch (e) {
    bad(
      `Redis chết SẼ KÉO SẬP API: lớp bọc ném lỗi ra ngoài (${(e as Error).message})`,
    );
  }

  dong();
}

async function main(): Promise<void> {
  console.log(
    '\x1b[1m═══ TỰ KIỂM TRẠNG THÁI DÙNG CHUNG QUA REDIS (task #5) ═══\x1b[0m\n',
  );
  kiemTinh();
  await kiemChay();

  console.log('');
  if (failures === 0) {
    console.log('\x1b[32m\x1b[1m═══ TẤT CẢ PASS ✓ ═══\x1b[0m');
    process.exit(0);
  }
  console.log(`\x1b[31m\x1b[1m═══ ${failures} MỤC FAIL ═══\x1b[0m`);
  process.exit(1);
}

void main();
