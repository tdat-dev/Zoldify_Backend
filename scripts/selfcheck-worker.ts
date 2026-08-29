/**
 * BỘ TỰ KIỂM TIẾN TRÌNH WORKER (task #14 bảng phân công) — viết TEST TRƯỚC.
 *
 * Chạy:
 *   npm run check:worker
 *
 * VÌ SAO TASK NÀY TỒN TẠI, NÓI BẰNG MÃ THẬT.
 *
 * `TasksService` có hai job `@Cron(EVERY_HOUR)`. Cả hai đụng tiền:
 * `autoCancelOrders` hoàn tiền ký quỹ về cho người mua, `settleDeliveredShipments`
 * giải ngân ký quỹ cho người bán. Chúng đăng ký bằng `@nestjs/schedule`, tức là
 * bộ hẹn giờ nằm TRONG tiến trình API — mỗi bản api dựng lên là một bộ hẹn giờ
 * nữa. Chạy 3 bản api thì tới 10 giờ có 3 lượt huỷ đơn chạy song song.
 *
 * Và chúng KHÔNG chống được chuyện đó. `OrdersService.cancelExpired` đọc đơn
 * rồi `assertCancellable` NGOÀI transaction, không khoá dòng; chỉ
 * `applyCancellation` mới vào transaction. Hai tiến trình cùng đọc thấy PENDING
 * thì cả hai cùng qua cửa, cùng gọi `escrowsService.refund` và cùng
 * `em.increment(stock)`. Hoàn tiền hai lần, cộng kho hai lần.
 *
 * Hôm nay compose chỉ dựng MỘT bản api nên lỗi chưa nổ. Nó là mìn chờ: đúng lúc
 * ai đó nâng số bản api để chịu tải thì nổ, và nổ ở chỗ không ai nhìn — không
 * có request nào lỗi, chỉ có sổ tiền lệch.
 *
 * NÊN BÀI TEST NÀY HỎI HAI CÂU, VÀ CÂU THỨ HAI MỚI LÀ CÂU KHÓ:
 *
 *   1. Cron đã ra khỏi API chưa? (phần tĩnh — đọc mã, không cần hạ tầng)
 *   2. Ra rồi thì nó có còn chạy ĐÚNG MỘT LẦN không? (phần động — dựng HAI
 *      worker thật trên Redis thật, đẩy một job, đếm số lần thực thi)
 *
 * Câu 2 phải chạy thật vì đây đúng là thứ không đọc mã mà biết được. Một hàng
 * đợi cấu hình sai vẫn "trông như" hàng đợi.
 *
 * Phần động cần Redis THẬT và MySQL THẬT (mục cuối dựng nguyên WorkerModule).
 * Thiếu thì bài test này FAIL, không SKIP. Một bài kiểm tự tắt khi
 * thiếu hạ tầng là bài kiểm luôn xanh, và bộ tự kiểm nào luôn xanh thì cả nhóm
 * học cách bỏ qua nó — đúng lý do đã ghi ở đầu selfcheck-ci.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { NestFactory } from '@nestjs/core';

// Nạp tĩnh chứ không `await import('../src/worker.module')`: script này chạy
// bằng ts-node ở chế độ CommonJS, mà `import()` động thì đi đường ESM và Node
// không giải được đuôi .ts qua đường đó ("Cannot find module ... imported
// from"). Cùng họ với chính con bug dual-package mà task này vừa sửa trong
// src/common/cache.config.ts.
import { WorkerModule } from '../src/worker.module';

import {
  TEN_HANG_DOI,
  LICH_LAP,
  JOB_HUY_DON_QUA_HAN,
  JOB_CHOT_VAN_DON,
} from '../src/ops/jobs/jobs.constants';
import { dangKyLichLap } from '../src/ops/jobs/jobs.schedule';
import { taoBoXuLy } from '../src/ops/jobs/jobs.processor';

const ROOT = path.join(__dirname, '..');
const doc = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const co = (p: string) => fs.existsSync(path.join(ROOT, p));

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};
const kiem = (dieuKien: boolean, m: string) => (dieuKien ? ok(m) : bad(m));

/**
 * Bỏ dòng chú thích trước khi soi HÀNH VI.
 *
 * Đã dính đúng bẫy này ở selfcheck-backup.ts: regex tìm lệnh xoá đệ quy khớp
 * trúng câu chú thích cảnh báo về chính lệnh đó rồi báo sai. Chú thích nói về
 * mã không phải là mã.
 */
const bodyOnly = (s: string) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

/** Duyệt src/ trên ĐĨA chứ không `git grep` — file mới chưa add vẫn phải thấy. */
function timTrongSrc(re: RegExp): string[] {
  const hit: string[] = [];
  const di = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) di(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) {
        if (re.test(bodyOnly(fs.readFileSync(p, 'utf8')))) {
          hit.push(path.relative(ROOT, p).replace(/\\/g, '/'));
        }
      }
    }
  };
  di(path.join(ROOT, 'src'));
  return hit;
}

// ══════════════════════════════════════════════════════════════════════════
// PHẦN TĨNH — đọc mã, không cần hạ tầng
// ══════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m── Phần tĩnh: cron đã ra khỏi API chưa ──\x1b[0m');

const pkg = JSON.parse(doc('package.json')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

// Tiến trình worker có thật và tách hẳn.
kiem(co('src/worker.ts'), 'src/worker.ts tồn tại (điểm vào riêng của worker)');

// Nếu worker nạp AppModule thì nó dựng luôn controller, gateway chat và mọi
// guard — tức là không tách gì cả, chỉ là bản api thứ hai không mở cổng.
kiem(
  co('src/worker.ts') && !/AppModule/.test(bodyOnly(doc('src/worker.ts'))),
  'src/worker.ts KHÔNG nạp AppModule (không dựng lại HTTP/gateway)',
);

kiem(
  /node dist\/worker/.test(pkg.scripts['start:worker'] ?? ''),
  'package.json có script start:worker chạy `node dist/worker`',
);

// Bộ hẹn giờ trong tiến trình phải biến mất HẲN.
//
// Không chỉ gỡ @Cron mà gỡ luôn gói @nestjs/schedule. Còn gói trong
// node_modules thì tuần sau ai đó gõ `@Cron` là mã biên dịch trót lọt và quả
// mìn quay lại, im lặng. Gỡ gói đi thì lỗi lộ ngay lúc import — máy chặn,
// không dựa vào việc nhớ (đúng nguyên tắc đã ghi ở eslint.config.mjs).
const cron = timTrongSrc(/@(Cron|Interval|Timeout)\s*\(/);
kiem(
  cron.length === 0,
  'không còn @Cron/@Interval/@Timeout trong src/' +
    (cron.length ? ' — còn: ' + cron.join(', ') : ''),
);

const sched = timTrongSrc(/ScheduleModule|@nestjs\/schedule/);
kiem(
  sched.length === 0,
  'không còn ScheduleModule trong src/' +
    (sched.length ? ' — còn: ' + sched.join(', ') : ''),
);

kiem(
  !('@nestjs/schedule' in pkg.dependencies),
  '@nestjs/schedule đã gỡ khỏi dependencies',
);

// Hàng đợi và bộ xử lý không được sống trong tiến trình API.
kiem(
  !/JobsModule/.test(bodyOnly(doc('src/app.module.ts'))),
  'AppModule KHÔNG nạp JobsModule (API không chạy job nền)',
);

// Phụ thuộc khai tường minh.
kiem('bullmq' in pkg.dependencies, 'bullmq nằm trong dependencies');
kiem(
  'ioredis' in pkg.dependencies,
  'ioredis khai tường minh (bullmq để nó là peer optional)',
);

// ── compose: worker phải chạy được thật ────────────────────────────────────
console.log('\n\x1b[1m── Phần tĩnh: compose ──\x1b[0m');

interface Svc {
  image?: string;
  command?: unknown;
  depends_on?: Record<string, { condition?: string }>;
  healthcheck?: { disable?: boolean; test?: unknown };
  environment?: Record<string, string>;
}
const compose = yaml.load(doc('docker-compose.yml')) as {
  services?: Record<string, Svc>;
};
const w = compose.services?.worker;

kiem(!!w, 'docker-compose.yml có service `worker`');

const cmd = JSON.stringify(w?.command ?? '');
kiem(/dist\/worker/.test(cmd), 'service worker chạy `node dist/worker`');

// Cùng image với api: một lần build, hai lệnh chạy. Build ảnh thứ hai là mở
// đường cho api và worker lệch phiên bản mã.
kiem(
  !!w?.image && w.image === compose.services?.api?.image,
  'worker dùng CÙNG image với api (một bản build, hai lệnh)',
);

kiem(
  w?.depends_on?.migrate?.condition === 'service_completed_successfully',
  'worker chờ migrate xong (job đụng bảng, chạy trước migration là hỏng)',
);
kiem(
  w?.depends_on?.redis?.condition === 'service_healthy',
  'worker chờ redis khoẻ (không có Redis thì không có hàng đợi)',
);

// Dockerfile khai HEALTHCHECK gọi HTTP vào PORT. Worker KHÔNG mở cổng HTTP nào,
// nên nếu để nguyên, container worker sẽ `unhealthy` vĩnh viễn — và mọi thứ
// dựa vào trạng thái đó (compose depends_on, cảnh báo giám sát) đọc sai.
kiem(
  w?.healthcheck?.disable === true || Array.isArray(w?.healthcheck?.test),
  'worker ghi đè/tắt HEALTHCHECK HTTP thừa hưởng từ Dockerfile',
);

kiem(
  !!w?.environment && 'REDIS_URL' in w.environment,
  'worker được trỏ REDIS_URL vào service redis nội bộ',
);

// Worker KHÔNG fail-open.
//
// Cả repo này fail-open: cache hỏng thì đọc thẳng MySQL, throttler hỏng thì cho
// request đi tiếp. Worker là NGOẠI LỆ và phải là ngoại lệ. Một worker nuốt lỗi
// Redis rồi chạy tiếp là một tiến trình sống nhăn mà không chạy job nào —
// đơn quá hạn không ai huỷ, tiền ký quỹ không ai giải ngân, và KHÔNG AI BIẾT.
// Chết to tiếng để `restart: unless-stopped` dựng lại còn hơn sống câm.
kiem(
  co('src/worker.ts') &&
    /process\.exit\(1\)/.test(bodyOnly(doc('src/worker.ts'))),
  'worker.ts thoát mã 1 khi không dựng được (KHÔNG fail-open như phần còn lại)',
);

// ── CI ─────────────────────────────────────────────────────────────────────
const ci = doc('.github/workflows/ci.yml');
kiem(/npm run check:worker/.test(ci), 'ci.yml chạy npm run check:worker');
kiem(/image:\s*redis/.test(ci), 'ci.yml khai service redis (bài test cần Redis thật)');
kiem(
  /selfcheck-worker/.test(doc('scripts/selfcheck-all.ts')),
  'selfcheck-all.ts có gọi suite worker',
);

// ══════════════════════════════════════════════════════════════════════════
// PHẦN ĐỘNG — Redis thật, hai worker thật
// ══════════════════════════════════════════════════════════════════════════
const REDIS_URL =
  process.env.TEST_REDIS_URL ??
  process.env.REDIS_URL ??
  'redis://127.0.0.1:6380';

/** Hàng đợi riêng cho bài test, không đụng hàng đợi thật. */
const QUEUE_TEST = TEN_HANG_DOI + '-selfcheck';

const doi = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lịch giả dùng cho phép thử "đổi lịch": khác pattern, giữ nguyên id. */
const LICH_DOI = LICH_LAP.map((l) => ({ ...l, pattern: '15,45 * * * *' }));

async function phanDong() {
  console.log('\n\x1b[1m── Phần động: Redis thật ──\x1b[0m');
  console.log('  (Redis: ' + REDIS_URL + ')');

  const conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  conn.on('error', () => {
    // Nuốt ở ĐÂY thôi: lỗi thật được `ping()` bên dưới báo cáo tử tế. Không gắn
    // handler thì ioredis ném lỗi không ai bắt và giết luôn tiến trình test
    // trước khi nó kịp in dòng FAIL — mất luôn thông báo hữu ích.
  });

  try {
    await conn.ping();
  } catch (e) {
    bad(
      'không nối được Redis tại ' +
        REDIS_URL +
        ' (' +
        (e as Error).message +
        ') — bật bằng: docker run -d --name zoldify-test-redis -p 6380:6379 redis:7',
    );
    conn.disconnect();
    return;
  }

  const queue = new Queue(QUEUE_TEST, { connection: conn });
  await queue.obliterate({ force: true }).catch(() => undefined);

  // Đăng ký lịch lặp.
  await dangKyLichLap(queue);
  let sch = await queue.getJobSchedulers();
  kiem(
    sch.length === LICH_LAP.length,
    'đăng ký đúng ' + LICH_LAP.length + ' lịch lặp (thấy ' + sch.length + ')',
  );
  const ids = sch.map((s) => String(s.key ?? s.id));
  kiem(
    LICH_LAP.every((l) => ids.includes(l.id)),
    'đủ id lịch: ' + LICH_LAP.map((l) => l.id).join(', '),
  );

  // Đổi lịch KHÔNG được nhân bản.
  //
  // Đây là bẫy kinh điển của BullMQ: `queue.add(..., { repeat })` khoá bản ghi
  // lặp theo NỘI DUNG lịch, nên sửa giờ chạy là tạo bản ghi MỚI, bản cũ vẫn
  // nằm đó chạy tiếp. Kết quả đúng bằng cái đang đi sửa: job tiền chạy hai
  // lần. `upsertJobScheduler` khoá theo ID nên thay tại chỗ.
  await dangKyLichLap(queue, LICH_DOI);
  sch = await queue.getJobSchedulers();
  kiem(
    sch.length === LICH_LAP.length,
    'đổi lịch rồi vẫn ' +
      LICH_LAP.length +
      ' bản ghi, không nhân bản (thấy ' +
      sch.length +
      ')',
  );
  kiem(
    sch.every((s) => s.pattern === LICH_DOI[0].pattern),
    'lịch mới ghi đè lịch cũ tại chỗ (upsert theo id, không theo nội dung)',
  );

  // Dọn lịch để phần sau đếm cho sạch: lịch lặp có thể tự đẻ job vào giữa bài.
  for (const s of sch) await queue.removeJobScheduler(String(s.key ?? s.id));
  await queue.drain(true).catch(() => undefined);

  // HAI worker, MỘT job, phải chạy ĐÚNG MỘT LẦN.
  //
  // Đây là câu hỏi trung tâm của cả task #14.
  let demHuy = 0;
  let demChot = 0;
  const tasksGia = {
    autoCancelOrders: async () => {
      demHuy++;
      await doi(50);
    },
    settleDeliveredShipments: async () => {
      demChot++;
      await doi(50);
    },
  };

  const xuLy = taoBoXuLy(tasksGia);
  const w1 = new Worker(QUEUE_TEST, xuLy as any, {
    connection: conn.duplicate(),
    concurrency: 1,
  });
  const w2 = new Worker(QUEUE_TEST, xuLy as any, {
    connection: conn.duplicate(),
    concurrency: 1,
  });
  for (const wk of [w1, w2]) wk.on('error', () => undefined);
  await Promise.all([w1.waitUntilReady(), w2.waitUntilReady()]);

  await queue.add(JOB_HUY_DON_QUA_HAN, {}, { attempts: 1 });
  await doi(1500);
  kiem(
    demHuy === 1,
    '2 worker + 1 job huỷ đơn → chạy đúng 1 lần (thực tế ' + demHuy + ')',
  );

  await queue.add(JOB_CHOT_VAN_DON, {}, { attempts: 1 });
  await doi(1500);
  kiem(
    demChot === 1,
    '2 worker + 1 job chốt vận đơn → chạy đúng 1 lần (thực tế ' + demChot + ')',
  );

  await w1.close();
  await w2.close();

  // Job lỗi không được giết worker.
  //
  // Nếu một lượt huỷ đơn ném lỗi và làm tiến trình chết, `restart` dựng lại
  // được nhưng lỗi lặp lại thành vòng khởi động lại vô tận — và lúc đó cron
  // không chạy nữa, im lặng.
  let demSauLoi = 0;
  const wLoi = new Worker(
    QUEUE_TEST,
    (async (job: { name: string }) => {
      if (job.name === 'no-tung') throw new Error('cố tình hỏng');
      demSauLoi++;
    }) as any,
    { connection: conn.duplicate(), concurrency: 1 },
  );
  wLoi.on('error', () => undefined);
  wLoi.on('failed', () => undefined);
  await wLoi.waitUntilReady();

  await queue.add('no-tung', {}, { attempts: 1 });
  await doi(800);
  await queue.add(JOB_CHOT_VAN_DON, {}, { attempts: 1 });
  await doi(1200);
  kiem(
    demSauLoi === 1 && wLoi.isRunning(),
    'job ném lỗi không giết worker — job kế vẫn chạy (sau lỗi: ' +
      demSauLoi +
      ')',
  );
  await wLoi.close();

  // WORKER CÓ DỰNG ĐƯỢC THẬT KHÔNG.
  //
  // Mục này thêm SAU, vì thiếu nó bài test đã xanh 26/26 trong khi
  // `node dist/worker` chết ngay dòng đầu:
  //
  //   Nest can't resolve dependencies of the ProductsService (…, ?).
  //   Make sure "CACHE_MANAGER" at index [4] is available in ProductsModule.
  //
  // Mọi mục tĩnh phía trên đều hỏi những câu ĐỌC MÃ LÀ TRẢ LỜI ĐƯỢC: file có
  // tồn tại không, có nạp AppModule không, compose có khai service không.
  // Không câu nào hỏi câu quan trọng nhất — "dựng lên có sống không". Và một
  // worker không dựng được thì mọi thứ ở trên đều đúng mà vô nghĩa.
  //
  // Nên mục này dựng WorkerModule THẬT. Nó cần cả MySQL lẫn Redis, tức bài
  // kiểm đắt hơn trước; đổi lại nó bắt được đúng loại lỗi mà bài kiểm rẻ hơn
  // không bao giờ thấy.
  process.env.DB_HOST = process.env.TEST_DB_HOST ?? '127.0.0.1';
  process.env.DB_PORT = process.env.TEST_DB_PORT ?? '3307';
  process.env.DB_USERNAME = process.env.TEST_DB_USER ?? 'root';
  process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? 'testpw';
  process.env.DB_DATABASE = process.env.TEST_DB_NAME ?? 'zoldify_test';
  process.env.REDIS_URL = REDIS_URL;

  let loiDung = '';
  try {
    // `abortOnError: false` là BẮT BUỘC ở đây. Mặc định Nest tự kết liễu tiến
    // trình khi dựng hỏng thay vì ném — và promise thì không bao giờ giải
    // quyết, nên `try/catch` này ngồi đợi mãi. Đã dính: cho TEST_DB_PORT sai
    // thì bài kiểm đứng hình quá 100 giây thay vì in FAIL.
    const app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
      abortOnError: false,
    });
    await app.close();
  } catch (e) {
    loiDung = (e as Error).message.split('\n')[0];
  }
  kiem(
    loiDung === '',
    'WorkerModule dựng được thật (Nest + TypeORM + BullMQ)' +
      (loiDung ? ` — ${loiDung}` : ''),
  );

  // Dọn lịch mà lần dựng thật vừa ghi vào hàng đợi SẢN PHẨM.
  //
  // Xoá đúng những id mình biết chứ không `obliterate` cả hàng đợi: lỡ ai đó
  // trỏ TEST_REDIS_URL vào Redis thật thì obliterate là xoá sạch job đang chờ.
  const qThat = new Queue(TEN_HANG_DOI, { connection: conn });
  for (const l of LICH_LAP) {
    await qThat.removeJobScheduler(l.id).catch(() => undefined);
  }
  await qThat.close();

  // Tên job lạ phải NÉM, không được im lặng bỏ qua.
  //
  // Gõ nhầm tên job mà bộ xử lý lặng lẽ `return` thì job "thành công" trong
  // bảng điều khiển BullMQ trong khi không có việc gì được làm. Ném lỗi để nó
  // vào danh sách failed và nhìn thấy được.
  let daNem = false;
  try {
    await (taoBoXuLy(tasksGia) as any)({ name: 'khong-co-that' });
  } catch {
    daNem = true;
  }
  kiem(daNem, 'tên job lạ → bộ xử lý ném lỗi (không im lặng bỏ qua)');

  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
  conn.disconnect();
}

async function main() {
  await phanDong();

  console.log(
    failures === 0
      ? '\n\x1b[32m═══ TẤT CẢ PASS ✓ ═══\x1b[0m'
      : '\n\x1b[31m═══ ' + failures + ' MỤC FAIL ═══\x1b[0m',
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
