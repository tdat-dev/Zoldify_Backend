/**
 * APP CÓ DỰNG ĐƯỢC KHÔNG, VÀ ROUTE CÓ THẬT KHÔNG.
 *
 *   npm run check:boot
 *
 * ─── Vì sao cần bài này, khi đã có 70 bài test ───────────────────────────────
 *
 * Vì test đơn vị `new Service(...)` bằng tay, không đi qua bộ tiêm phụ thuộc của
 * Nest và không đi qua bộ định tuyến. Hai thứ đó chỉ hỏng lúc CHẠY THẬT.
 *
 * Đã dính hai lần, và lần thứ hai là hôm nay:
 *
 *  1. Task #14 — bài tự kiểm worker xanh 26/26 trong khi `node dist/worker` chết
 *     ngay lúc khởi động vì thiếu `CACHE_MANAGER`. Bài kiểm lúc đó hỏi "file có
 *     tồn tại không", không hỏi "chạy có lên không".
 *
 *  2. Sitemap — 8/8 test xanh, `npm run build` sạch, mà app không dựng nổi:
 *
 *       Nest can't resolve dependencies of the SitemapService
 *       (ProductRepository, CategoryRepository, ShopRepository, ?).
 *       Please make sure that the argument Number at index [3] is available.
 *
 *     Nguyên nhân: tham số có giá trị mặc định trong TypeScript, nhưng trình
 *     biên dịch vẫn ghi `Number` vào `design:paramtypes` nên Nest đi tìm một
 *     provider tên `Number`. Test không thấy vì nó tự `new` service.
 *
 *     Ngay sau đó là lỗi thứ hai, cùng loại: hai route sitemap con bị đẩy vào
 *     dưới `/api` vì chưa được thêm vào danh sách loại trừ prefix. Route vẫn
 *     tồn tại, chỉ là ở sai chỗ — và bảng chỉ mục trỏ vào chỗ trả 404.
 *
 * Cả hai lỗi đó CI sẽ không bắt được: `test/app.e2e-spec.ts` có dựng AppModule
 * thật, nhưng nó chạy bằng `npm run test:e2e` — mà CI chưa bao giờ gọi lệnh đó.
 * Một cái chốt không chạy thì không phải là chốt.
 *
 * ─── Bài này hỏi đúng ba câu ─────────────────────────────────────────────────
 *
 *   1. `NestFactory.create(AppModule)` có xong không (bắt lỗi tiêm phụ thuộc).
 *   2. Các route công khai có đúng đường dẫn không (bắt lỗi prefix/định tuyến).
 *   3. Route cần đăng nhập có còn chặn không (bắt việc lỡ tay gỡ guard).
 *
 * Cần: MySQL. Không cần Redis (thiếu thì cache rơi về in-memory).
 */
import 'reflect-metadata';
import * as fs from 'fs';

/**
 * In bằng `fs.writeSync(1, ...)` chứ không `console.log`.
 *
 * Trên Windows, stdout nối vào pipe là GHI BẤT ĐỒNG BỘ. Bài này phải
 * `process.exit()` (xem `thoat` bên dưới), và exit sẽ cắt phần chưa kịp ghi —
 * đã dính: bài kiểm chạy 10 phút rồi bị giết mà không in nổi một dòng nào.
 * `writeSync` thì ghi xong mới trả về.
 */
const in_ = (m: string): void => {
  fs.writeSync(1, m + String.fromCharCode(10));
};

/**
 * Thoát DỨT KHOÁT.
 *
 * Khi `NestFactory.create` hỏng giữa chừng, vài module đã kịp mở kết nối
 * (TypeORM giữ pool). Những handle đó giữ event loop sống mãi, nên bài kiểm
 * treo thay vì báo đỏ — mà treo thì CI chỉ biết sau khi hết giờ. Đã dính thật.
 */
// Khai báo bằng `function` chứ không phải arrow gán vào `const`: TypeScript chỉ
// tin một hàm "không bao giờ trả về" khi nó là khai báo hàm (hoặc const có chú
// thích kiểu tường minh). Viết arrow không chú thích thì sau `thoat(1)` trình
// biên dịch vẫn cho là mã chạy tiếp, và báo "Variable 'app' is used before being
// assigned" ở tám chỗ phía dưới.
function thoat(ma: number): never {
  process.exit(ma);
}

const E = process.env;
E.NODE_ENV ??= 'test';
E.DB_HOST ??= '127.0.0.1';
E.DB_PORT ??= '3307';
E.DB_USERNAME ??= 'root';
E.DB_PASSWORD ??= 'testpw';
E.DB_DATABASE ??= 'zoldify_test';
E.JWT_ACCESS_SECRET ??= 'check-boot-access';
E.JWT_REFRESH_TOKEN_SECRET ??= 'check-boot-refresh';
E.JWT_ACCESS_EXPIRE ??= '1d';
E.JWT_REFRESH_EXPIRE ??= '7d';
E.SITE_URL ??= 'http://localhost:3001';

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const X = '\x1b[0m';

let hong = 0;
function kiem(ten: string, dat: boolean, chiTiet = ''): void {
  if (dat) {
    in_(`  ${G}✓ PASS${X}  ${ten}${chiTiet ? ` — ${chiTiet}` : ''}`);
  } else {
    hong += 1;
    in_(`  ${R}✗ FAIL${X}  ${ten}${chiTiet ? ` — ${chiTiet}` : ''}`);
  }
}

async function main(): Promise<void> {
  in_(`${B}═══ TỰ KIỂM KHỞI ĐỘNG — app có dựng được và route có thật ═══${X}\n`);

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
  const { NestFactory, Reflector } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('../src/app.module');
  const { configureRouting } = require('../src/core/routing.config');
  const { TransformInterceptor } = require('../src/core/transform.interceptor');
  const { HttpExceptionFilter } = require('../src/core/http-exception.filter');

  in_(`${B}— 1. Dựng ứng dụng thật —${X}`);
  let app: {
    listen: (p: number) => Promise<void>;
    close: () => Promise<void>;
    getHttpServer: () => { address: () => { port: number } };
    get: (t: unknown) => unknown;
    useGlobalPipes: (p: unknown) => void;
    useGlobalFilters: (f: unknown) => void;
    useGlobalInterceptors: (i: unknown) => void;
  };
  try {
    // `abortOnError: false` là bắt buộc: mặc định Nest tự `process.exit(1)` khi
    // dựng hỏng, nên bài kiểm sẽ chết trước khi kịp in ra lỗi gì. Với cờ này nó
    // ném lỗi và mình đọc được nguyên nhân.
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
  } catch (e) {
    kiem('NestFactory.create(AppModule)', false, (e as Error).message.split('\n')[0]);
    in_(`\n${R}${B}═══ HỎNG NGAY Ở BƯỚC DỰNG — xem lỗi trên ═══${X}`);
    in_((e as Error).message);
    thoat(1);
  }
  kiem('NestFactory.create(AppModule) — mọi phụ thuộc tiêm được', true);

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
  configureRouting(app);
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  kiem('app.listen() — mở được cổng', true, base);
  /* eslint-enable */

  const lay = async (
    duong: string,
  ): Promise<{ status: number; body: string }> => {
    const r = await fetch(base + duong);
    return { status: r.status, body: await r.text() };
  };

  in_(`\n${B}— 2. Route công khai có đúng đường dẫn —${X}`);

  const goc = await lay('/');
  kiem('GET / (healthcheck, ngoài prefix /api)', goc.status === 200, `HTTP ${goc.status}`);

  const dsSan = await lay('/api/v1/products');
  kiem('GET /api/v1/products (có prefix + version)', dsSan.status === 200, `HTTP ${dsSan.status}`);

  // `/health` phải ở GỐC domain: Dockerfile thăm dò đúng đường dẫn này, và nằm
  // dưới /api thì Docker gõ vào chỗ trả 404 rồi coi container là chết.
  const suc = await lay('/health');
  kiem('GET /health ở gốc domain', suc.status === 200, `HTTP ${suc.status}`);
  let than: { db?: string; redis?: string; status?: string } = {};
  try {
    than = JSON.parse(suc.body) as typeof than;
  } catch {
    /* để rỗng — mục dưới sẽ FAIL và nói rõ */
  }
  kiem(
    'health nói rõ trạng thái db và redis',
    than.db === 'up' && ['up', 'down', 'off'].includes(than.redis ?? ''),
    `db=${than.db} redis=${than.redis} status=${than.status}`,
  );
  kiem(
    'health KHÔNG bị bọc phong bì {statusCode, data}',
    !suc.body.includes('"statusCode"'),
    'bọc vào thì mã ngoài luôn 200 và healthcheck vô dụng như bản cũ',
  );

  // Mã request: có ở MỌI phản hồi, kể cả phản hồi lỗi — vì đúng những request
  // bị từ chối mới là thứ hay phải đi tra nhất.
  const coId = await fetch(base + '/');
  kiem(
    'mọi phản hồi mang X-Request-Id',
    (coId.headers.get('x-request-id') ?? '').length > 0,
    coId.headers.get('x-request-id') ?? '(không có)',
  );

  // Header do client gửi đi THẲNG vào log, nên phải làm sạch.
  //
  // Dạng nguy hiểm nhất — xuống dòng để chèn một dòng log giả — thì tầng HTTP
  // đã chặn sẵn: `fetch` (và bộ phân tích của Node) từ chối gửi header có
  // CR/LF. Nên ở đây kiểm dạng mà tầng HTTP CHO qua: dấu nháy, khoảng trắng, và
  // chuỗi dài quá mức. Một mã request 5.000 ký tự lặp lại mỗi dòng log cũng đủ
  // làm log không đọc được nữa.
  const bay = await fetch(base + '/', {
    headers: { 'X-Request-Id': `x"} {"level":"info" ${'A'.repeat(5000)}` },
  });
  const traVe = bay.headers.get('x-request-id') ?? '';
  kiem(
    'X-Request-Id bậy thì bị thay, không lọt nguyên văn',
    !traVe.includes('"') && !traVe.includes(' ') && traVe.length <= 64,
    `trả về ${traVe.length} ký tự: ${JSON.stringify(traVe.slice(0, 40))}`,
  );

  // Ba route sitemap phải nằm ở GỐC domain. Đây là chỗ vừa hỏng: chúng bị đẩy
  // vào /api vì thiếu trong danh sách exclude của setGlobalPrefix.
  const chiMuc = await lay('/sitemap.xml');
  kiem('GET /sitemap.xml ở gốc domain', chiMuc.status === 200, `HTTP ${chiMuc.status}`);
  kiem(
    'sitemap.xml là BẢNG CHỈ MỤC, không nhét URL sản phẩm',
    chiMuc.body.includes('<sitemapindex') && !chiMuc.body.includes('/product/'),
  );

  const tinh = await lay('/sitemap-static.xml');
  kiem('GET /sitemap-static.xml ở gốc domain', tinh.status === 200, `HTTP ${tinh.status}`);

  // File con: 200 nếu lô có hàng, 404 nếu lô rỗng. Cả hai đều đúng — điều PHẢI
  // loại trừ là 404 kiểu "route không tồn tại". Phân biệt bằng nội dung: bộ
  // định tuyến trả "Cannot GET ...", còn controller trả thông điệp tiếng Việt.
  const con = await lay('/sitemap-products-0.xml');
  kiem(
    'GET /sitemap-products-0.xml — route CÓ tồn tại ở gốc domain',
    con.status === 200 || con.body.includes('Không có file sitemap'),
    `HTTP ${con.status}${con.body.includes('Cannot GET') ? ' — route KHÔNG được đăng ký' : ''}`,
  );

  const loLa = await lay('/sitemap-products-abc.xml');
  kiem('lô không phải số → 404 (không chạm database)', loLa.status === 404, `HTTP ${loLa.status}`);

  // ĐI HẾT CHUỖI: bảng chỉ mục → từng file con.
  //
  // Bắt buộc phải kiểm, vì đây là lỗi đã lọt lên staging một lần: bảng chỉ mục
  // trỏ file con sang domain WEB (SITE_URL) trong khi mấy file đó do API phục
  // vụ. Cả `/sitemap.xml` lẫn `/sitemap-static.xml` gọi riêng đều trả 200, nên
  // kiểm từng cái một thì không thấy gì — chỉ khi ĐI THEO đường dẫn mà bảng chỉ
  // mục đưa ra mới lộ: cả hai file con đều 404.
  //
  // Kiểm hai vế: gốc phải khớp API_PUBLIC_URL, và đường dẫn phải mở được thật.
  // Cùng mặc định với SitemapService, để lúc không đặt biến thì bài kiểm vẫn so
  // đúng thứ ứng dụng thật sự dùng chứ không so với chuỗi rỗng.
  const gocApi = (process.env.API_PUBLIC_URL || 'http://localhost:3000')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
  const fileCon = [...chiMuc.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => m[1],
  );
  kiem('bảng chỉ mục có liệt kê file con', fileCon.length > 0, `${fileCon.length} file`);

  const saiGoc = fileCon.filter((u) => !u.startsWith(gocApi));
  kiem(
    `file con nằm ở gốc của API (${gocApi})`,
    gocApi.length > 0 && saiGoc.length === 0,
    saiGoc.length ? `sai gốc: ${saiGoc[0]}` : '',
  );

  let conHong = 0;
  for (const u of fileCon) {
    const duong = u.slice(gocApi.length) || '/';
    const r = await lay(duong);
    // 404 "lô rỗng" không tính là hỏng — nhưng bảng chỉ mục vốn chỉ liệt kê lô
    // CÓ hàng, nên gặp nó ở đây là bất thường. Chỉ tha khi database rỗng (CI).
    if (r.status !== 200 && !r.body.includes('Không có file sitemap')) conHong++;
  }
  kiem(
    'mọi file con trong bảng chỉ mục đều mở được',
    conHong === 0,
    conHong ? `${conHong}/${fileCon.length} không mở được` : '',
  );

  // Mọi `<loc>` phải là URL DÙNG ĐƯỢC.
  //
  // Nghe như thừa, nhưng đây đúng là lỗi vừa bắt được trên api-staging: biến
  // `SITE_URL` ở đó là một DANH SÁCH ngăn bởi dấu phẩy (main.ts dùng nó cho
  // CORS), mà sitemap đọc thô rồi nối đường dẫn vào sau, nên phát ra:
  //
  //   <loc>https://staging.zoldify.com,https://admin-staging.zoldify.com/sitemap-static.xml</loc>
  //
  // Cả `npm test` lẫn CI đều xanh trong khi Google nhận toàn URL rác — vì trên
  // máy dev `SITE_URL` chỉ có một giá trị nên không ai thấy. Kiểm ở đây vì đây
  // là chỗ duy nhất chạy với biến môi trường thật.
  const locs = [
    ...chiMuc.body.matchAll(/<loc>([^<]+)<\/loc>/g),
    ...tinh.body.matchAll(/<loc>([^<]+)<\/loc>/g),
    ...(con.status === 200 ? con.body.matchAll(/<loc>([^<]+)<\/loc>/g) : []),
  ].map((m) => m[1]);
  const hongUrl = locs.filter((u) => {
    if (u.includes(',')) return true;
    try {
      new URL(u);
      return false;
    } catch {
      return true;
    }
  });
  kiem(
    `mọi <loc> là URL hợp lệ (${locs.length} địa chỉ)`,
    locs.length > 0 && hongUrl.length === 0,
    hongUrl.length ? `hỏng: ${hongUrl[0]}` : '',
  );

  in_(`\n${B}— 3. Guard còn chặn —${X}`);

  // Tài liệu API (`/api/docs`) KHÔNG kiểm ở đây, có lý do.
  //
  // Bài này dựng app bằng `NestFactory.create` + `configureRouting` chứ không
  // chạy trọn `main.ts`, nên Swagger không được mount — gọi vào sẽ 404 vì
  // route không tồn tại, không phải vì chốt chặn làm việc. Một mục xanh/đỏ ở
  // đây sẽ nói dối về thứ nó tưởng đang đo.
  //
  // Việc chặn nằm ở `src/core/swagger-guard.spec.ts`: 9 bài, giả lập được địa
  // chỉ IP nên kiểm được cả ba nhánh (có tài khoản / loopback / ở xa) — thứ mà
  // gọi HTTP từ chính máy đang chạy không bao giờ kiểm được.
  const rieng = await lay('/api/v1/chat/conversations');
  kiem('GET /api/v1/chat/conversations không token → 401', rieng.status === 401, `HTTP ${rieng.status}`);

  await app.close();

  in_(
    hong === 0
      ? `\n${G}${B}═══ TẤT CẢ PASS ✓ — app dựng được, route đúng chỗ ═══${X}`
      : `\n${R}${B}═══ ${hong} MỤC FAIL ═══${X}`,
  );
  thoat(hong === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  in_(String(e instanceof Error ? e.stack : e));
  thoat(1);
});
