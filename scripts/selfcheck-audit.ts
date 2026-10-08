/**
 * TỰ KIỂM NHẬT KÝ HÀNH ĐỘNG ADMIN (task #34) — bài kiểm ĐẦU-CUỐI.
 *
 * Chạy:
 *   npm run check:audit
 *   (cần lược đồ ĐÃ CHẠY MIGRATION — cùng database với check:index/check:boot)
 *
 * VÌ SAO CẦN BÀI NÀY KHI ĐÃ CÓ SPEC JEST.
 *
 * `admin-audit.interceptor.spec.ts` dựng ExecutionContext GIẢ và gọi thẳng
 * interceptor. Nó chứng minh interceptor làm đúng việc của nó — nhưng không
 * chứng minh được rằng một request admin THẬT sẽ đi qua nó. Ca số 5 trong spec
 * đó chỉ đọc chuỗi `AdminAuditInterceptor` trong `app.module.ts`: đủ để bắt lỗi
 * "quên đấu dây", KHÔNG đủ để bắt lỗi "đấu dây rồi nhưng metadata guard đọc
 * sai nên không route nào khớp".
 *
 * Bài này dựng app thật, ký một token admin thật, gọi một route admin thật qua
 * HTTP, rồi đi đếm dòng trong database. Không có chỗ nào giả.
 *
 * Đây đúng khoảng trống mà `docs/BAN-GIAO.md` mục 7 kể về `check:boot`: test
 * đơn vị tự `new Service(...)` nên không đi qua bộ tiêm phụ thuộc lẫn bộ định
 * tuyến, và hai lần liền test xanh mà app không dựng nổi.
 */
import 'reflect-metadata';

// Trỏ vào DATABASE TEST, giống hệt check:boot (dòng 76-80 của file đó).
//
// Thiếu khối này, bài kiểm rơi về DB dev trong .env (cổng 3306) và chết ngay
// ở NestFactory.create với "Access denied for user root@localhost" — tức cổng
// chỉ chạy được trên máy nào tình cờ có sẵn MySQL cục bộ đúng mật khẩu dev.
// Đo ngày 06/10: check:boot XANH còn check:audit ĐỎ trên cùng một máy, và
// khác biệt duy nhất giữa hai script là khối này.
//
// Dùng `??=` nên biến môi trường đặt sẵn ngoài shell vẫn thắng. Và vì ConfigModule
// nạp .env SAU (dotenv không ghi đè biến đã có), các giá trị dưới đây giữ nguyên.
//
// Bài này tạo admin thật và ghi dòng thật, nên trỏ vào DB test là bắt buộc,
// không chỉ là tiện: chạy nhầm vào DB dev là rải rác dữ liệu kiểm thử.
const E = process.env;
E.NODE_ENV ??= 'test';
E.DB_HOST ??= '127.0.0.1';
E.DB_PORT ??= '3307';
E.DB_USERNAME ??= 'root';
E.DB_PASSWORD ??= 'testpw';
E.DB_DATABASE ??= 'zoldify_test';

const B = '\x1b[1m';
const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';

let hong = 0;
const kiem = (ten: string, dat: boolean, them = '') => {
  if (dat) console.log(`  ${G}✓ PASS${X}  ${ten}${them ? ` — ${them}` : ''}`);
  else {
    hong++;
    console.log(`  ${R}✗ FAIL${X}  ${ten}${them ? ` — ${them}` : ''}`);
  }
};

async function main(): Promise<void> {
  console.log(
    `${B}═══ TỰ KIỂM NHẬT KÝ ADMIN — request thật có để lại vết không ═══${X}\n`,
  );

  // JWT_ACCESS_SECRET phải có TRƯỚC khi nạp AppModule: JwtStrategy đọc nó
  // trong constructor, và một secret rỗng làm mọi token bị từ chối — bài kiểm
  // sẽ đỏ vì lý do chẳng liên quan gì tới nhật ký.
  if (!process.env.JWT_ACCESS_SECRET) {
    process.env.JWT_ACCESS_SECRET = 'selfcheck-audit-secret';
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
  const { NestFactory, Reflector } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const jwt = require('jsonwebtoken');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../src/app.module');
  const { configureRouting } = require('../src/core/routing.config');
  const { TransformInterceptor } = require('../src/core/transform.interceptor');
  const { HttpExceptionFilter } = require('../src/core/http-exception.filter');

  console.log(`${B}— 1. Dựng app thật —${X}`);
  let app: any;
  try {
    // `abortOnError: false` vì mặc định Nest `process.exit(1)` khi dựng hỏng,
    // và bài kiểm sẽ chết trước khi kịp in ra nguyên nhân.
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
  } catch (e) {
    kiem(
      'NestFactory.create(AppModule)',
      false,
      (e as Error).message.split('\n')[0],
    );
    console.log(`\n${R}${B}═══ HỎNG NGAY Ở BƯỚC DỰNG ═══${X}`);
    process.exit(1);
  }
  kiem('NestFactory.create(AppModule)', true);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  configureRouting(app);
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  kiem('app.listen()', true, base);

  const ds: any = app.get(DataSource);

  // ── Dựng một admin thật trong database ────────────────────────────────────
  //
  // JwtStrategy.validate đi tìm người dùng theo `payload.sub` và so
  // `token_version`. Không có dòng thật thì mọi token đều 401, và bài kiểm sẽ
  // đỏ ở chỗ chẳng liên quan gì tới nhật ký.
  console.log(`\n${B}— 2. Dựng một admin thật rồi ký token —${X}`);
  const email = `selfcheck-audit-${Date.now()}@zoldify.local`;
  await ds.query(
    'INSERT INTO `users` (`full_name`, `email`, `password`, `role`, `token_version`) VALUES (?, ?, ?, ?, ?)',
    ['Selfcheck Audit', email, 'x', 'admin', 0],
  );
  const [{ id: adminId }] = await ds.query(
    'SELECT id FROM `users` WHERE email = ?',
    [email],
  );
  kiem('tạo user role=admin', !!adminId, `id=${adminId}`);

  const token = jwt.sign(
    {
      sub: adminId,
      full_name: 'Selfcheck Audit',
      email,
      role: 'admin',
      token_version: 0,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '5m' },
  );

  const goi = async (duong: string, method: string, body?: unknown) => {
    const r = await fetch(base + duong, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.text() };
  };

  const demLog = async (): Promise<number> => {
    const [{ n }] = await ds.query(
      'SELECT COUNT(*) AS n FROM `admin_action_logs` WHERE admin_id = ?',
      [adminId],
    );
    return Number(n);
  };

  // ── Route ĐỌC: không được để lại vết ──────────────────────────────────────
  console.log(`\n${B}— 3. GET không phải hành động —${X}`);
  const truocGet = await demLog();
  const res1 = await goi('/api/v1/admin/stats', 'GET');
  kiem(
    'GET /api/v1/admin/stats với token admin → 200',
    res1.status === 200,
    `HTTP ${res1.status}`,
  );
  kiem('GET không sinh dòng nhật ký nào', (await demLog()) === truocGet);

  // ── Route GHI: phải để lại đúng một vết ───────────────────────────────────
  console.log(`\n${B}— 4. Một hành động admin thật để lại đúng một vết —${X}`);
  const res2 = await goi('/api/v1/admin/settings', 'PATCH', {
    selfcheck_audit_key: String(Date.now()),
  });
  kiem(
    'PATCH /api/v1/admin/settings → 200',
    res2.status === 200,
    `HTTP ${res2.status}`,
  );

  // Interceptor ghi SAU khi handler xong và không chờ ghi xong mới trả lời
  // (fail-open, không chặn request), nên phải cho nó một nhịp.
  await new Promise((r) => setTimeout(r, 300));

  const rows = await ds.query(
    'SELECT * FROM `admin_action_logs` WHERE admin_id = ? ORDER BY id DESC',
    [adminId],
  );
  kiem('đúng 1 dòng nhật ký được ghi', rows.length === 1, `có ${rows.length}`);

  if (rows.length) {
    const r0 = rows[0];
    kiem('ghi đúng admin_id', Number(r0.admin_id) === Number(adminId));
    kiem('ghi đúng method', r0.method === 'PATCH', r0.method);
    kiem(
      'ghi đúng đường dẫn',
      String(r0.path).includes('/admin/settings'),
      r0.path,
    );
    kiem(
      'đặt tên hành động',
      String(r0.action).includes('admin.settings'),
      r0.action,
    );
    kiem('có ghi IP', !!r0.ip, r0.ip ?? '(trống)');
  }

  // ── M-01: PATCH /admin/users/:id chặn ghi cột nhạy cảm ─────────────────────
  console.log(
    `\n${B}— 5. M-01: PATCH /admin/users/:id từ chối ghi password/role/token_version —${X}`,
  );

  // Tạo một user mục tiêu (không phải admin)
  const targetEmail = `selfcheck-target-${Date.now()}@zoldify.local`;
  await ds.query(
    'INSERT INTO `users` (`full_name`, `email`, `password`, `role`, `token_version`) VALUES (?, ?, ?, ?, ?)',
    ['Target User', targetEmail, 'old_hash', 'buyer', 0],
  );
  const [{ id: targetId }] = await ds.query(
    'SELECT id FROM `users` WHERE email = ?',
    [targetEmail],
  );
  kiem('tạo user mục tiêu (buyer)', !!targetId, `id=${targetId}`);

  // Lấy password cũ để so sánh
  const [{ password: passCu }] = await ds.query(
    'SELECT `password` FROM `users` WHERE id = ?',
    [targetId],
  );

  // 5a: Gửi password → phải 400
  const resPass = await goi(`/api/v1/admin/users/${targetId}`, 'PATCH', {
    password: 'abc',
  });
  kiem(
    'PATCH body {password:"abc"} → 400',
    resPass.status === 400,
    `HTTP ${resPass.status}`,
  );

  // 5b: Password trong DB phải KHÔNG đổi
  const [{ password: passSau }] = await ds.query(
    'SELECT `password` FROM `users` WHERE id = ?',
    [targetId],
  );
  kiem(
    'users.password KHÔNG bị ghi đè',
    passSau === passCu,
    `trước=${passCu} sau=${passSau}`,
  );

  // 5c: Gửi role → phải 400
  const resRole = await goi(`/api/v1/admin/users/${targetId}`, 'PATCH', {
    role: 'admin',
  });
  kiem(
    'PATCH body {role:"admin"} → 400',
    resRole.status === 400,
    `HTTP ${resRole.status}`,
  );

  // 5d: Role trong DB phải KHÔNG đổi
  const [{ role: roleSau }] = await ds.query(
    'SELECT `role` FROM `users` WHERE id = ?',
    [targetId],
  );
  kiem(
    'users.role KHÔNG bị ghi đè',
    roleSau === 'buyer',
    `trước=buyer sau=${roleSau}`,
  );

  // 5e: Gửi token_version → phải 400
  const resTv = await goi(`/api/v1/admin/users/${targetId}`, 'PATCH', {
    token_version: 999,
  });
  kiem(
    'PATCH body {token_version:999} → 400',
    resTv.status === 400,
    `HTTP ${resTv.status}`,
  );

  // 5f: token_version trong DB phải KHÔNG đổi
  const [{ token_version: tvSau }] = await ds.query(
    'SELECT `token_version` FROM `users` WHERE id = ?',
    [targetId],
  );
  kiem(
    'users.token_version KHÔNG bị ghi đè',
    tvSau === 0,
    `trước=0 sau=${tvSau}`,
  );

  // 5g: Ca đối chứng — gửi full_name (cột cho phép) → phải 200
  const resOk = await goi(`/api/v1/admin/users/${targetId}`, 'PATCH', {
    full_name: 'New Name',
  });
  kiem(
    'PATCH body {full_name:"New Name"} → 200',
    resOk.status === 200,
    `HTTP ${resOk.status}`,
  );

  // 5h: Ca đối chứng (ValidationPipe) — lỗi phải do ValidationPipe chặn, KHÔNG phải service guard
  // ValidationPipe trả message là MẢNG, service guard trả message là CHUỖI.
  // Nếu ai đổi DTO về `any`, ValidationPipe bỏ qua → message thành chuỗi → test này ĐỎ.
  const resCtr = await goi(`/api/v1/admin/users/${targetId}`, 'PATCH', {
    password: 'abc',
  });
  let messageLaMang = false;
  try {
    const body = JSON.parse(resCtr.body);
    messageLaMang = Array.isArray(body?.message);
  } catch {
    // Bỏ qua lỗi parse JSON - messageLaMang giữ false
  }
  kiem(
    'ValidationPipe chặn ở controller (message là mảng)',
    messageLaMang,
    `message=${resCtr.body?.slice(0, 100)}`,
  );

  // Dọn user mục tiêu
  await ds.query('DELETE FROM `users` WHERE id = ?', [targetId]);

  // ── Dọn ───────────────────────────────────────────────────────────────────
  await ds.query('DELETE FROM `admin_action_logs` WHERE admin_id = ?', [
    adminId,
  ]);
  await ds.query('DELETE FROM `users` WHERE id = ?', [adminId]);
  await ds.query('DELETE FROM `settings` WHERE `key` LIKE ?', [
    'selfcheck_audit_key',
  ]);
  await app.close();
  /* eslint-enable */

  console.log(
    hong === 0
      ? `\n${G}${B}═══ TẤT CẢ PASS ✓ — request admin thật có để lại vết ═══${X}\n`
      : `\n${R}${B}═══ ${hong} MỤC FAIL ═══${X}\n`,
  );
  process.exit(hong === 0 ? 0 : 1);
}

void main();
