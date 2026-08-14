import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '@identity/auth/jwt-auth.guard';

/**
 * Mọi route phải hoặc có JwtAuthGuard, hoặc được đánh dấu công khai có chủ ý.
 *
 * Vì sao cần bài kiểm này thay vì tự nhớ: dự án KHÔNG có guard toàn cục. Trong
 * `app.module.ts` chỉ đăng ký ThrottlerGuard và MaintenanceGuard; xác thực do
 * từng controller tự gắn `@UseGuards(JwtAuthGuard)`. Quên một chỗ là route đó
 * chạy với `request.user` bằng undefined, không có gì báo — không lỗi biên
 * dịch, không cảnh báo lint, Swagger vẫn sinh ra bình thường.
 *
 * Chuyện đã xảy ra thật: `WalletsController` không có guard nào trong suốt thời
 * gian dài. Nó phơi POST /wallets/topup — hàm cộng thẳng vào sổ cái — ra
 * Internet. Đọc mắt thường không thấy, vì file trông y hệt mọi controller khác;
 * chỉ có chỗ THIẾU một dòng.
 *
 * Bài kiểm đọc metadata mà Nest thật sự dùng lúc chạy, không dò chữ trong file.
 * Bản dò chữ trước đó báo nhầm `AdminController` là thiếu guard, chỉ vì nó viết
 * `@UseGuards(JwtAuthGuard, AdminGuard)` hai guard trên một dòng.
 */

/** Route công khai có chủ ý: người chưa đăng nhập PHẢI gọi được. */
const PUBLIC_ROUTES: Record<string, string> = {
  'AppController.getHello': 'trang chào, dùng để kiểm máy chủ còn sống',
  'PayosController.handleWebhook':
    'PayOS gọi vào, không có JWT. Tự xác thực bằng chữ ký trong body.',
};

type Route = { key: string; guards: string[]; isPublic: boolean };

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) controllerFiles(p, out);
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function collectRoutes(): Route[] {
  const src = path.resolve(__dirname, '..', '..');
  const routes: Route[] = [];

  for (const file of controllerFiles(src)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file);
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const cls = exported as new (...args: any[]) => unknown;
      if (Reflect.getMetadata(PATH_METADATA, cls) === undefined) continue;

      const classGuards: any[] = Reflect.getMetadata('__guards__', cls) ?? [];
      const proto = cls.prototype;

      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        // Chỉ phương thức có @Get/@Post/... mới mang metadata đường dẫn
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;

        const methodGuards: any[] =
          Reflect.getMetadata('__guards__', handler) ?? [];

        routes.push({
          key: `${cls.name}.${name}`,
          guards: [...classGuards, ...methodGuards].map((g) =>
            typeof g === 'function' ? g.name : String(g),
          ),
          isPublic:
            Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true ||
            Reflect.getMetadata(IS_PUBLIC_KEY, cls) === true,
        });
      }
    }
  }
  return routes;
}

describe('Mọi route đều được canh', () => {
  const routes = collectRoutes();

  it('tìm thấy đủ controller để bài kiểm có nghĩa', () => {
    // Chốt chặn cho chính bài kiểm: nếu cách nạp file hỏng, `routes` rỗng và
    // mọi expect bên dưới đều xanh một cách vô nghĩa.
    expect(routes.length).toBeGreaterThan(80);
  });

  it('không route nào chạy mà thiếu xác thực', () => {
    const naked = routes
      .filter((r) => !r.guards.includes(JwtAuthGuard.name))
      .filter((r) => !r.isPublic)
      .filter((r) => !(r.key in PUBLIC_ROUTES))
      .map((r) => r.key);

    expect(naked).toEqual([]);
  });

  it('POST /wallets/topup chỉ dành cho admin', () => {
    const topup = routes.find((r) => r.key === 'WalletsController.topup');
    expect(topup).toBeDefined();
    // In tiền được thì phải là admin. Route này từng không có guard nào.
    expect(topup!.guards).toContain('AdminGuard');
    expect(topup!.guards).toContain(JwtAuthGuard.name);
  });
});
