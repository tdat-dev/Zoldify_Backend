/**
 * TỰ KIỂM TỒN KHO REAL-TIME (task #26b) — bài kiểm ĐẦU-CUỐI.
 *
 * Chạy:
 *   npm run check:stock
 *   (cần DB test ở 3307 VÀ Redis — `docker start zoldify-test-mysql zoldify-test-redis`)
 *
 * VÌ SAO CẦN BÀI NÀY KHI ĐÃ CÓ `stock-events.spec.ts`.
 *
 * Spec đó mock Redis. Nó chứng minh HÌNH DẠNG: phát đúng kênh, đúng room, đúng
 * hai trường, không nổ khi Redis chết. Cả bốn điều đó nằm trọn trong mã
 * TypeScript nên mock là đủ, và dựng Redis thật chỉ để kiểm chúng là trả giá
 * hạ tầng cho một phép kiểm không cần tới nó.
 *
 * Nhưng có SÁU mối nối mà spec đó không chạm được, và cả sáu đều đã từng hỏng
 * thật ở các task trước:
 *
 *   1. `StockEventsModule` có được `AppModule` nhập không — `check:worker` bắt
 *      được đúng lỗi này ở `TasksModule` ngày 06/10 (thiếu `Product`), và
 *      `npm test` khi đó XANH vì spec tự `new TasksService(...)`.
 *   2. `ProductsService` do bộ tiêm phụ thuộc dựng có nhận được
 *      `StockEventsService` thật không, hay nhận `undefined`.
 *   3. Client PHÁT có nối được Redis thật không (`REDIS_URL` đúng cổng chưa —
 *      `check:redis` vừa phải sửa 6380 → 6379 ngày 07/10).
 *   4. Client NHẬN có là MỘT KẾT NỐI KHÁC không. Dùng lại client phát thì Redis
 *      trả "Connection in subscriber mode" và cơ chế hỏng ở lượt đầu tiên.
 *   5. `StockModule.onModuleInit` có thật sự `subscribe` không, và listener
 *      `message` có gọi tới gateway không.
 *   6. Socket.io adapter có được gắn vào HTTP server không, và namespace
 *      `/stock` có nhận được client không.
 *
 * Bài này dựng app thật, nối Redis thật, mở hai socket client thật, rồi gọi một
 * route HTTP thật của người bán. Không có chỗ nào giả.
 *
 * VÌ SAO ĐI QUA `PATCH /products/:id/stock` CHỨ KHÔNG QUA ĐẶT ĐƠN.
 *
 * Ba chỗ phát đi cùng một hàm `phat()`, qua cùng một kênh, tới cùng một
 * gateway. Sáu mối nối trên là PHẦN DÙNG CHUNG — chứng minh một lần ở chỗ rẻ
 * nhất là đủ. Còn đặt đơn thì phải dựng giỏ, địa chỉ, ký quỹ, và GHN (gọi
 * MẠNG); phần tồn kho của luồng đó đã có `dat-hang-va-ton-kho.spec.ts` đo.
 *
 * Bù lại, mục 5 dưới đây ĐỌC MÃ NGUỒN và đếm đủ ba chỗ gọi `phat()` — rẻ, và
 * bắt được đúng cái mà con đường HTTP này bỏ sót: ai đó xoá một chỗ phát.
 */
import 'reflect-metadata';

// Trỏ vào DATABASE TEST, giống hệt `selfcheck-audit.ts` (xem lý do dài ở đó:
// thiếu khối này thì bài rơi về DB dev cổng 3306 và chết ở NestFactory.create).
// Bài này tạo user + sản phẩm thật, nên trỏ vào DB test là bắt buộc.
const E = process.env;
E.NODE_ENV ??= 'test';
E.DB_HOST ??= '127.0.0.1';
E.DB_PORT ??= '3307';
E.DB_USERNAME ??= 'root';
E.DB_PASSWORD ??= 'testpw';
E.DB_DATABASE ??= 'zoldify_test';

// REDIS_URL: KHÔNG dùng `??=` vào một giá trị mặc định rồi coi là xong.
//
// `StockEventsService` và `StockModule` đều trả `null` khi không có
// `REDIS_URL`, và khi đó `phat()` im lặng bỏ qua — ĐÚNG cho production (sàn vẫn
// bán được khi Redis chết), nhưng với bài kiểm này thì nó biến "cơ chế hỏng"
// thành "không đo được". Nên: có mặc định để chạy được trên máy sạch, nhưng
// mục 1 dưới đây BẮT TAY THẬT với Redis trước khi đo bất cứ thứ gì.
E.REDIS_URL ??= 'redis://127.0.0.1:6379';

const B = '\x1b[1m';
const G = '\x1b[32m';
const R = '\x1b[31m';
const Y = '\x1b[33m';
const X = '\x1b[0m';

let hong = 0;
const kiem = (ten: string, dat: boolean, them = '') => {
  if (dat) console.log(`  ${G}✓ PASS${X}  ${ten}${them ? ` — ${them}` : ''}`);
  else {
    hong++;
    console.log(`  ${R}✗ FAIL${X}  ${ten}${them ? ` — ${them}` : ''}`);
  }
};

/** Chờ một gói tin trên socket, hoặc hết giờ. */
function cho<T>(
  dk: { once: (ev: string, cb: (d: T) => void) => void },
  suKien: string,
  hanMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const h = setTimeout(() => resolve(null), hanMs);
    dk.once(suKien, (d: T) => {
      clearTimeout(h);
      resolve(d);
    });
  });
}

async function main(): Promise<void> {
  console.log(
    `${B}═══ TỰ KIỂM TỒN KHO REAL-TIME — đổi kho thật có tới socket thật không ═══${X}\n`,
  );

  // JWT_ACCESS_SECRET phải có TRƯỚC khi nạp AppModule: JwtStrategy đọc nó trong
  // constructor, và secret rỗng làm mọi token bị từ chối — bài sẽ đỏ vì lý do
  // chẳng liên quan tới tồn kho.
  if (!process.env.JWT_ACCESS_SECRET) {
    process.env.JWT_ACCESS_SECRET = 'selfcheck-stock-secret';
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
  const { NestFactory, Reflector } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const jwt = require('jsonwebtoken');
  const { DataSource } = require('typeorm');
  const { io } = require('socket.io-client');
  const Redis = require('ioredis');
  const { AppModule } = require('../src/app.module');
  const { configureRouting } = require('../src/core/routing.config');
  const { TransformInterceptor } = require('../src/core/transform.interceptor');
  const { HttpExceptionFilter } = require('../src/core/http-exception.filter');
  const {
    KENH_TON_KHO,
    StockEventsService,
  } = require('../src/catalog/stock/stock-events.service');

  // ── 1. Redis phải nối được THẬT, trước khi đo bất cứ thứ gì ────────────────
  //
  // Nếu bỏ qua bước này: `phat()` im lặng bỏ qua khi không có Redis, socket
  // không nhận được gì, và mục 4 đỏ với thông điệp "socket không nhận được" —
  // tức báo sai nguyên nhân. Hỏng ở đây thì dừng luôn, đừng đo tiếp.
  console.log(`${B}— 1. Redis thật —${X}`);
  const doRedis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    lazyConnect: true,
  });
  doRedis.on('error', () => {
    // Thiếu listener 'error' là giết cả tiến trình Node — xem StockModule.
  });
  let redisOk = false;
  try {
    await doRedis.connect();
    redisOk = (await doRedis.ping()) === 'PONG';
  } catch (e) {
    kiem('PING Redis', false, (e as Error).message.split('\n')[0]);
  }
  if (!redisOk) {
    console.log(
      `\n${Y}${B}KHÔNG ĐO ĐƯỢC${X} — ${process.env.REDIS_URL} không trả PONG.\n` +
        `  Chạy: ${B}docker start zoldify-test-redis${X}\n`,
    );
    process.exit(1);
  }
  kiem('PING Redis', true, process.env.REDIS_URL);

  // ── 2. Dựng app thật ──────────────────────────────────────────────────────
  console.log(`\n${B}— 2. Dựng app thật + socket adapter —${X}`);
  let app: any;
  try {
    // `abortOnError: false` vì mặc định Nest `process.exit(1)` khi dựng hỏng và
    // bài sẽ chết trước khi kịp in nguyên nhân.
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

  // Mối nối số 2: bộ tiêm phụ thuộc có dựng được `StockEventsService` không, và
  // nó có nắm một client Redis thật không.
  //
  // `app.get` ném khi provider không có trong cây — tức bắt được đúng lỗi
  // "`StockEventsModule` chưa được nhập", loại lỗi mà `npm test` không thấy vì
  // spec tự `new` service.
  let phatSvc: any = null;
  try {
    phatSvc = app.get(StockEventsService);
  } catch (e) {
    kiem(
      'app.get(StockEventsService)',
      false,
      (e as Error).message.split('\n')[0],
    );
  }
  kiem('app.get(StockEventsService) — module đã được nhập', !!phatSvc);

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
  const cong = app.getHttpServer().address().port;
  const base = `http://127.0.0.1:${cong}`;
  kiem('app.listen()', true, base);

  const ds: any = app.get(DataSource);

  // ── 3. Dữ liệu thật: người bán + sản phẩm ─────────────────────────────────
  console.log(`\n${B}— 3. Người bán thật + sản phẩm thật —${X}`);

  // Category: dùng lại nếu đã có. Bài này chạy nhiều lần trên cùng database,
  // và `categories.slug` là UNIQUE.
  await ds.query(
    "INSERT IGNORE INTO `categories` (`name`, `slug`) VALUES ('Selfcheck Stock', 'selfcheck-stock')",
  );
  const [cat] = await ds.query(
    "SELECT id FROM `categories` WHERE slug = 'selfcheck-stock'",
  );
  kiem('có category', !!cat?.id, `id=${cat?.id}`);

  const email = `selfcheck-stock-${Date.now()}@zoldify.local`;
  await ds.query(
    'INSERT INTO `users` (`full_name`, `email`, `password`, `role`, `token_version`) VALUES (?, ?, ?, ?, ?)',
    ['Selfcheck Stock', email, 'x', 'seller', 0],
  );
  const [{ id: sellerId }] = await ds.query(
    'SELECT id FROM `users` WHERE email = ?',
    [email],
  );
  kiem('tạo người bán', !!sellerId, `id=${sellerId}`);

  const KHO_DAU = 10;
  const KHO_MOI = 7;
  const slug = `selfcheck-stock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await ds.query(
    'INSERT INTO `products` (`name`, `slug`, `price`, `stock`, `status`, `category_id`, `seller_id`) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['Selfcheck Stock', slug, 100000, KHO_DAU, 'active', cat.id, sellerId],
  );
  const [{ id: pid }] = await ds.query(
    'SELECT id FROM `products` WHERE slug = ?',
    [slug],
  );
  kiem('tạo sản phẩm', !!pid, `id=${pid} stock=${KHO_DAU}`);

  // Token: ký đúng hình dạng JwtStrategy đòi (`sub` + `token_version` phải khớp
  // dòng thật trong database, nếu không mọi request đều 401).
  const token = jwt.sign(
    {
      sub: sellerId,
      full_name: 'Selfcheck Stock',
      email,
      role: 'seller',
      token_version: 0,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '5m' },
  );

  // ── 4. Hai socket client thật ─────────────────────────────────────────────
  console.log(`\n${B}— 4. Hai socket client thật vào namespace /stock —${X}`);

  // Namespace `/stock` cho phép KHÁCH — hai client dưới đây KHÔNG gửi token.
  // Đó là chủ ý, và cũng là một phép kiểm: nếu ai đó thêm guard bắt token vào
  // gateway này, bài sẽ đỏ ngay ở `connect` dưới.
  //
  // `transports: ['websocket']` — bỏ qua bước long-polling nâng cấp lên ws.
  // Mặc định của socket.io-client là polling trước, và việc nâng cấp xảy ra SAU
  // khi `connect` đã bắn; `join` room ở phiên polling rồi chuyển sang ws là
  // thêm một biến số không liên quan gì tới thứ cần đo.
  const noi = (): any =>
    io(`${base}/stock`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
  const A = noi();
  const Bc = noi();

  const choNoi = (dk: any, ten: string) =>
    new Promise<boolean>((resolve) => {
      const h = setTimeout(() => resolve(false), 5000);
      dk.on('connect', () => {
        clearTimeout(h);
        resolve(true);
      });
      dk.on('connect_error', (e: Error) => {
        clearTimeout(h);
        console.log(`    ${R}${ten}: ${e.message}${X}`);
        resolve(false);
      });
    });
  const [okA, okB] = await Promise.all([choNoi(A, 'A'), choNoi(Bc, 'B')]);
  kiem('client A nối được /stock (không cần token)', okA);
  kiem('client B nối được /stock (không cần token)', okB);
  if (!okA || !okB) {
    await app.close();
    await doRedis.quit().catch(() => undefined);
    console.log(`\n${R}${B}═══ KHÔNG NỐI ĐƯỢC SOCKET — dừng ═══${X}\n`);
    process.exit(1);
  }

  // `emitWithAck`: gateway trả `{ok}` cho `theo-doi`. Chờ ack chứ không
  // `setTimeout` đoán — `join` xong mới được phép đổi kho, nếu không gói tin
  // bay trước khi client vào room và bài đỏ ngẫu nhiên.
  const PID_KHAC = Number(pid) + 1_000_000;
  const ackA = await A.emitWithAck('theo-doi', { product_id: Number(pid) });
  const ackB = await Bc.emitWithAck('theo-doi', { product_id: PID_KHAC });
  kiem('A join room sản phẩm', ackA?.ok === true, `product_${pid}`);
  kiem('B join room KHÁC', ackB?.ok === true, `product_${PID_KHAC}`);

  // Ca đối chứng: id không hợp lệ phải bị từ chối, không join im lặng.
  const ackXau = await A.emitWithAck('theo-doi', { product_id: 'abc' });
  kiem("'theo-doi' với product_id không phải số → ok:false", ackXau?.ok === false);

  // ── 5. Đổi kho THẬT qua HTTP → socket phải nhận ───────────────────────────
  console.log(
    `\n${B}— 5. PATCH /products/:id/stock thật → gói tin tới socket —${X}`,
  );

  const tinA = cho<any>(A, 'ton-kho', 5000);
  const tinB = cho<any>(Bc, 'ton-kho', 5000);

  const res = await fetch(`${base}/api/v1/products/${pid}/stock`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ stock: KHO_MOI }),
  });
  const thanBody = await res.text();
  kiem(
    `PATCH stock ${KHO_DAU} → ${KHO_MOI} trả 200`,
    res.status === 200,
    `HTTP ${res.status} ${thanBody.slice(0, 160)}`,
  );

  const goiA = await tinA;
  kiem(
    'A NHẬN được gói tin trong 5s',
    goiA !== null,
    goiA === null ? 'hết giờ, không có gói nào' : JSON.stringify(goiA),
  );
  if (goiA) {
    kiem(
      'gói tin đúng product_id + stock MỚI',
      goiA.product_id === Number(pid) && goiA.stock === KHO_MOI,
      JSON.stringify(goiA),
    );
    // Namespace này cho phép khách, nên gói tin không được mang gì khác —
    // thêm `sold_count` hay `seller_id` là phát dữ liệu kinh doanh ra ngoài.
    kiem(
      'gói tin CHỈ có hai trường',
      Object.keys(goiA).length === 2,
      Object.keys(goiA).join(','),
    );
  }

  // Kho trong database phải khớp con số vừa phát: phát một số KHÁC số đã lưu là
  // tệ hơn không phát — client hiển thị sai cho tới khi người dùng tải lại trang,
  // và không ai biết là nó sai.
  //
  // So với `goiA.stock` chứ không với hằng `KHO_MOI`. Đo ngày 07/10: bản đầu của
  // mục này so với hằng số, và trong ca đối chứng (gỡ chỗ phát) nó vẫn PASS với
  // dòng `db=7 phát=undefined` in ra ngay bên cạnh — một mục nghiệm thu PASS
  // trong khi tự in ra bằng chứng nó không đo được gì.
  const [sauPatch] = await ds.query(
    'SELECT stock FROM `products` WHERE id = ?',
    [pid],
  );
  kiem(
    'database khớp con số vừa phát',
    goiA !== null && Number(sauPatch.stock) === goiA.stock,
    `db=${sauPatch.stock} phát=${goiA === null ? '(không có gói nào)' : goiA.stock}`,
  );

  // ── 6. Ca đối chứng: KHÔNG phát toàn sàn ──────────────────────────────────
  console.log(`\n${B}— 6. Ca đối chứng — room, không phải broadcast —${X}`);
  kiem(
    'B (room khác) KHÔNG nhận được gói tin của A',
    (await tinB) === null,
    'nếu PASS cả mục 5 và mục này thì đúng là room',
  );

  // Và đối chứng cho CHÍNH ca đối chứng trên: B im lặng có thể là vì socket B
  // đã chết, không phải vì room. Publish thẳng vào Redis cho room của B.
  //
  // Đây cũng là phép kiểm cho bên NHẬN một cách độc lập với bên phát: nếu
  // `StockModule` quên `subscribe`, mục 5 và mục này cùng đỏ; nếu chỉ
  // `phat()` hỏng thì mục 5 đỏ còn mục này xanh. Hai mục tách được hai nguyên
  // nhân ra.
  const tinB2 = cho<any>(Bc, 'ton-kho', 5000);
  await doRedis.publish(
    KENH_TON_KHO,
    JSON.stringify({ product_id: PID_KHAC, stock: 3 }),
  );
  const goiB2 = await tinB2;
  kiem(
    'B VẪN sống: publish vào room của B thì B nhận được',
    goiB2 !== null && goiB2.product_id === PID_KHAC && goiB2.stock === 3,
    goiB2 === null ? 'hết giờ — socket B đã chết, mục 6 ở trên vô nghĩa' : JSON.stringify(goiB2),
  );

  // Gói tin rác trên kênh chung không được làm chết tiến trình. Nếu nó chết thì
  // bài này không in nổi dòng kết luận — và đó chính là tín hiệu.
  await doRedis.publish(KENH_TON_KHO, '{khong-phai-json');
  await doRedis.publish(KENH_TON_KHO, JSON.stringify({ thieu: 'product_id' }));
  await new Promise((r) => setTimeout(r, 300));
  kiem('gói tin rác trên kênh chung không giết tiến trình api', true);

  // ── 7. Ba chỗ phát phải còn đủ ────────────────────────────────────────────
  //
  // Con đường HTTP ở mục 5 chỉ đi qua MỘT trong ba chỗ. Mục này đọc mã nguồn —
  // rẻ, và bắt được đúng cái mục 5 bỏ sót: ai đó xoá chỗ phát ở đặt đơn hoặc
  // huỷ đơn. Chỗ huỷ đơn là chỗ `worker` cũng chạy, tức chỗ không có cổng nào
  // khác chạm tới.
  console.log(`\n${B}— 7. Ba chỗ đổi kho đều còn gọi phat() —${X}`);
  const { readFileSync } = require('node:fs');

  // BỎ DÒNG COMMENT TRƯỚC KHI ĐẾM. Đo ngày 07/10: ca đối chứng gỡ chỗ phát bằng
  // cách thêm `// ` vào đầu dòng — cách người ta gỡ thật, không phải xoá hẳn —
  // và mục này vẫn PASS vì chuỗi `stockEvents.phat(` còn nguyên trong comment.
  // Mục 5 bắt được, nhưng mục 5 không chạm hai chỗ kia.
  //
  // Bỏ cả `/** ... */` nữa: hai chỗ phát đều có khối comment dài ngay trên,
  // và một khối như vậy rất dễ bị ai đó nhắc lại tên hàm trong văn.
  const dem = (duong: string) => {
    const s = readFileSync(duong, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    return (s.match(/stockEvents\.phat\(/g) ?? []).length;
  };
  const nOrders = dem('src/ordering/orders/orders.service.ts');
  const nProducts = dem('src/catalog/products/products.service.ts');
  kiem(
    'orders.service.ts có 2 chỗ phát (đặt đơn + huỷ đơn)',
    nOrders === 2,
    `đếm được ${nOrders}`,
  );
  kiem(
    'products.service.ts có 1 chỗ phát (người bán sửa kho)',
    nProducts === 1,
    `đếm được ${nProducts}`,
  );

  // ── Dọn ───────────────────────────────────────────────────────────────────
  A.close();
  Bc.close();
  await ds.query('DELETE FROM `products` WHERE id = ?', [pid]);
  await ds.query('DELETE FROM `users` WHERE id = ?', [sellerId]);
  await app.close();
  await doRedis.quit().catch(() => undefined);
  /* eslint-enable */

  console.log(
    hong === 0
      ? `\n${G}${B}═══ TẤT CẢ PASS ✓ — đổi kho thật tới được socket thật qua Redis thật ═══${X}\n`
      : `\n${R}${B}═══ ${hong} MỤC FAIL ═══${X}\n`,
  );
  process.exit(hong === 0 ? 0 : 1);
}

void main();
