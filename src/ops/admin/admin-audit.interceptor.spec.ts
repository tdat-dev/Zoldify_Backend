import * as fs from 'node:fs';
import { of } from 'rxjs';
import { DataSource } from 'typeorm';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AdminGuard } from '@common/guards/admin.guard';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';
import { AdminActionLog } from './entities/admin-action-log.entity';
import { AdminAuditInterceptor } from './admin-audit.interceptor';

/**
 * NHẬT KÝ HÀNH ĐỘNG ADMIN (task #34) — viết TEST TRƯỚC.
 *
 * VÌ SAO TASK NÀY TỒN TẠI, NÓI BẰNG ROUTE THẬT.
 *
 * Hôm nay admin khoá một tài khoản, đổi vai trò một người thành `admin`, xoá
 * một người dùng, sửa `settings`, duyệt một lệnh rút tiền — và **không để lại
 * một dòng nào** ở đâu cả. Grep toàn bộ `src/` với `audit_log|admin_log|
 * activity_log`: không có gì.
 *
 * Nghĩa là khi có chuyện — một tài khoản bị khoá oan, một người tự nâng mình
 * lên `admin`, một lệnh rút bị duyệt sai — không ai trả lời được câu đầu tiên
 * mà người ta sẽ hỏi: **ai làm, lúc nào**. Sổ cái che được phần tiền, nhưng
 * `toggleUserLock` và `changeUserRole` thì không đi qua sổ cái nào.
 *
 * VÌ SAO LÀ INTERCEPTOR, KHÔNG PHẢI RẢI LỜI GỌI TRONG TỪNG SERVICE.
 *
 * 19 route admin nằm ở NĂM controller khác nhau (`admin`, `users`, `wallets`,
 * `withdrawals.admin`, `settings`). Rải lời gọi `ghiNhatKy(...)` thì chỉ cần
 * quên một chỗ là mất vết — và chỗ quên bao giờ cũng là chỗ thêm sau, tức là
 * chỗ chưa ai nghĩ kỹ. Interceptor bám theo `AdminGuard`: route nào có guard
 * đó là tự động được ghi, không ai phải nhớ.
 *
 * MỤC 5 LÀ MỤC KHÓ NHẤT, VÀ NÓ LÀ LÝ DO BÀI NÀY KHÔNG CHỈ TEST HÀNH VI.
 * Một interceptor đúng nhưng không được đăng ký toàn cục thì không route thật
 * nào đi qua nó — test vẫn xanh, hệ thống vẫn không ghi gì. Đúng cái bẫy đã
 * sinh ra `check:boot`, ghi ở docs/BAN-GIAO.md mục 7.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

/** Dựng một ExecutionContext giả đủ dùng cho interceptor. */
function boiCanh(opts: {
  method: string;
  url: string;
  guards?: unknown[];
  user?: { id: number; role: string } | undefined;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  ip?: string;
}): ExecutionContext {
  const handler = function xuLy() {};
  // Nest lưu guard vào metadata `__guards__` trên chính hàm xử lý. Interceptor
  // đọc đúng chỗ đó để biết route này có phải route admin không.
  Reflect.defineMetadata('__guards__', opts.guards ?? [], handler);

  const req = {
    method: opts.method,
    originalUrl: opts.url,
    url: opts.url,
    user: opts.user,
    body: opts.body ?? {},
    params: opts.params ?? {},
    ip: opts.ip ?? '10.0.0.7',
    get: () => 'jest',
  };

  return {
    getHandler: () => handler,
    getClass: () => class KhongCoGuard {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

const kePhia: CallHandler = { handle: () => of({ ok: true }) };

describe('AdminAuditInterceptor — nhật ký hành động admin', () => {
  let dataSource: DataSource;
  let interceptor: AdminAuditInterceptor;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [AdminActionLog],
      synchronize: true,
      logging: false,
    });

    try {
      await dataSource.initialize();
    } catch (err) {
      // Ném chứ không skip, cùng lý do đã ghi ở ledger.service.spec.ts: một
      // bài kiểm tự bỏ qua khi thiếu hạ tầng là bài kiểm luôn xanh.
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }

    interceptor = new AdminAuditInterceptor(
      dataSource.getRepository(AdminActionLog),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(AdminActionLog).clear();
  });

  const dem = () => dataSource.getRepository(AdminActionLog).count();
  const chay = (ctx: ExecutionContext) =>
    new Promise<void>((resolve, reject) => {
      interceptor.intercept(ctx, kePhia).subscribe({
        next: () => undefined,
        error: reject,
        // Interceptor ghi log SAU khi handler xong, nên phải đợi complete —
        // kiểm ngay sau `next` là đo lúc dòng chưa kịp ghi.
        complete: () => setTimeout(resolve, 50),
      });
    });

  it('1. ghi lại một hành động admin đổi trạng thái', async () => {
    await chay(
      boiCanh({
        method: 'PATCH',
        url: '/api/v1/admin/users/42/toggle-lock',
        guards: [JwtAuthGuard, AdminGuard],
        user: { id: 7, role: 'admin' },
        params: { id: '42' },
      }),
    );

    const rows = await dataSource.getRepository(AdminActionLog).find();
    expect(rows).toHaveLength(1);
    expect(rows[0].admin_id).toBe(7);
    expect(rows[0].method).toBe('PATCH');
    expect(rows[0].path).toContain('/admin/users/42/toggle-lock');
    expect(rows[0].target_id).toBe('42');
    expect(rows[0].ip).toBe('10.0.0.7');
  });

  it('2. KHÔNG ghi route đọc — GET không phải hành động', async () => {
    await chay(
      boiCanh({
        method: 'GET',
        url: '/api/v1/admin/users',
        guards: [JwtAuthGuard, AdminGuard],
        user: { id: 7, role: 'admin' },
      }),
    );
    expect(await dem()).toBe(0);
  });

  it('3. KHÔNG ghi route không có AdminGuard, dù người gọi là admin', async () => {
    // Admin cũng mua hàng như mọi người. Ghi cả giỏ hàng của họ vào nhật ký
    // quản trị là làm loãng đúng thứ nhật ký này sinh ra để giữ.
    await chay(
      boiCanh({
        method: 'POST',
        url: '/api/v1/carts',
        guards: [JwtAuthGuard],
        user: { id: 7, role: 'admin' },
      }),
    );
    expect(await dem()).toBe(0);
  });

  it('4. KHÔNG ghi mật khẩu hay token vào nhật ký', async () => {
    // Nhật ký là thứ đọc nhiều, sao chép nhiều, dán vào báo cáo nhiều. Để một
    // mật khẩu lọt vào đây là biến bảng gác an ninh thành kho rò rỉ.
    await chay(
      boiCanh({
        method: 'PATCH',
        url: '/api/v1/admin/users/42',
        guards: [JwtAuthGuard, AdminGuard],
        user: { id: 7, role: 'admin' },
        params: { id: '42' },
        body: {
          full_name: 'Nguyen Van A',
          password: 'sieu-bi-mat',
          refresh_token: 'eyJhbGciOi',
        },
      }),
    );

    const [row] = await dataSource.getRepository(AdminActionLog).find();
    const payload = JSON.stringify(row.payload ?? {});
    expect(payload).toContain('Nguyen Van A');
    expect(payload).not.toContain('sieu-bi-mat');
    expect(payload).not.toContain('eyJhbGciOi');
  });

  it('5. interceptor ĐƯỢC ĐĂNG KÝ TOÀN CỤC trong AppModule', () => {
    // Mục khó nhất. Một interceptor đúng mà không đấu dây thì không route thật
    // nào đi qua nó: test hành vi vẫn xanh, hệ thống vẫn không ghi gì. Đây
    // đúng loại lỗi đã sinh ra check:boot.
    // `import('node:fs')` động không dùng được: jest chạy CommonJS nên nó ném
    // "A dynamic import callback was invoked without --experimental-vm-modules".
    const nguon = fs.readFileSync('src/app.module.ts', 'utf8');

    expect(nguon).toContain('AdminAuditInterceptor');
    expect(nguon).toContain('APP_INTERCEPTOR');
  });

  it('6. ghi log hỏng KHÔNG được làm chết request của admin', async () => {
    // Fail-open có chủ ý. Bảng nhật ký mới, migration có thể chưa chạy trên
    // một máy nào đó; lúc đó admin vẫn phải khoá được tài khoản lừa đảo.
    // Đánh đổi: mất vết còn hơn mất cả chức năng quản trị.
    const repoHong = {
      create: (x: unknown) => x,
      save: () => Promise.reject(new Error('bảng không tồn tại')),
    } as never;
    const i2 = new AdminAuditInterceptor(repoHong);

    await expect(
      new Promise((resolve, reject) => {
        i2.intercept(
          boiCanh({
            method: 'DELETE',
            url: '/api/v1/admin/users/42',
            guards: [JwtAuthGuard, AdminGuard],
            user: { id: 7, role: 'admin' },
            params: { id: '42' },
          }),
          kePhia,
        ).subscribe({ next: resolve, error: reject });
      }),
    ).resolves.toEqual({ ok: true });
  });
});
