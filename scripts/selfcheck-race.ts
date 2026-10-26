/**
 * BỘ TỰ KIỂM ĐUA (race condition) — chạy nhiều người dùng ĐỒNG THỜI.
 *
 * Chạy:
 *   npm run check:race
 *
 * VÌ SAO CẦN BỘ NÀY, TRONG KHI ĐÃ CÓ `npm test`.
 *
 * Mọi bài kiểm hiện có chạy MỘT luồng: gọi hàm, xem kết quả. Nhưng cả một lớp
 * lỗi chỉ tồn tại khi có HAI người cùng lúc — "đọc trạng thái → quyết định →
 * ghi trạng thái" mà không khoá thì hai người cùng đọc được cùng một con số,
 * cùng cho là hợp lệ, rồi cùng ghi. Chạy một luồng thì không bao giờ thấy.
 *
 * Đây cũng là lớp lỗi ĐẮT NHẤT của một sàn thương mại: bán quá số lượng, trả
 * tiền hai lần, cộng kho ảo. Chúng không báo lỗi cho ai — chỉ để lại một con số
 * sai trong database.
 *
 * CÁCH ĐỌC KẾT QUẢ. Bộ này CÓ những mục đỏ có chủ đích: chúng là kết quả audit,
 * không phải hỏng hóc mới. Danh sách `DA_BIET_HONG` ở dưới ghi rõ chỗ nào đang
 * hỏng và ai chịu trách nhiệm. Bộ kiểm thoát mã ≠0 khi xuất hiện chỗ hỏng MỚI
 * ngoài danh sách đó — cùng nguyên tắc bánh cóc của `check-lint.mjs`.
 *
 * Mỗi kịch bản hỏng đều đi kèm một ĐỐI CHỨNG chạy cùng dữ liệu, cùng số người,
 * chỉ khác ở chỗ có khoá. Nếu đối chứng cũng đỏ thì bài kiểm sai, không phải mã
 * sai — và ta biết ngay thay vì đi sửa nhầm chỗ.
 */
import AppDataSource from '../src/data-source';
import type { DataSource } from 'typeorm';

// Dựng `AppModule` kéo theo cả nhánh xác thực, và `JwtStrategy` ném ngay lúc
// khởi tạo nếu thiếu khoá. Bài kiểm này không đăng nhập ai — nó gọi thẳng
// service — nên giá trị ở đây chỉ cần tồn tại.
const E = process.env;
E.JWT_ACCESS_SECRET ??= 'check-race-access';
E.JWT_REFRESH_TOKEN_SECRET ??= 'check-race-refresh';
E.JWT_ACCESS_EXPIRE ??= '1d';
E.JWT_REFRESH_EXPIRE ??= '7d';
E.SITE_URL ??= 'http://localhost:3001';
E.API_PUBLIC_URL ??= 'http://localhost:3000';

const N = 20; // số người "bấm" cùng lúc

/**
 * R1 VÀ R4 GỌI THẲNG `OrdersService` THẬT, KHÔNG CHÉP LẠI TRÌNH TỰ SQL.
 *
 * Bản đầu của hai kịch bản này tự viết lại đúng trình tự mà `orders.service.ts`
 * đang làm — đọc kho, chờ một nhịp, rồi trừ. Cách đó chứng minh được rằng LỖI
 * CÓ THẬT, nhưng nó có một khuyết tật chí mạng: **sửa mã thật xong bài kiểm vẫn
 * đỏ y nguyên**, vì nó đang đo bản chép chứ không đo mã. Một bài kiểm không thể
 * chuyển sang xanh thì không dùng để nghiệm thu bản sửa được.
 *
 * Nên nay hai kịch bản này dựng hẳn `AppModule` và lấy `OrdersService` ra khỏi
 * bộ tiêm phụ thuộc. Chậm hơn vài giây, đổi lại chúng đo đúng thứ người dùng
 * chạm vào.
 *
 * R2 và R3 GIỮ NGUYÊN dạng SQL trần, có chủ đích: chúng là ĐỐI CHỨNG, việc của
 * chúng là chứng minh phép đo đúng (có khoá thì kết quả đúng). Đối chứng mà đi
 * qua cùng lớp mã với thứ đang nghi ngờ thì không còn là đối chứng.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
interface DichVuDon {
  create: (dto: unknown, user: unknown) => Promise<unknown>;
  cancelExpired: (orderId: number) => Promise<void>;
}

async function layDichVuDon(): Promise<{
  svc: DichVuDon;
  lay: <T>(duongDan: string, ten: string) => T;
  dong: () => Promise<void>;
}> {
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../src/app.module');
  const { OrdersService } = require('../src/ordering/orders/orders.service');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  // Từ rà soát 26/10 (mục 2) `orders.create` TỪ CHỐI đơn thiếu địa chỉ GHN,
  // nên R1/R5 không còn né được bước hỏi phí ship bằng cách bỏ trống nó. Thay
  // lời gọi mạng ra GHN bằng một con số cố định, trên CHÍNH singleton mà
  // `OrdersService` đang giữ: bài này đo khoá trong database, không đo đường
  // truyền, và 20 lượt gọi GHN thật cùng lúc thì vừa chậm vừa đỏ vì mạng.
  const { GhnService } = require('../src/ordering/ghn/ghn.service');
  app.get(GhnService).calculateFee = () => Promise.resolve({ total: 30000 });
  return {
    svc: app.get(OrdersService) as DichVuDon,
    // R6..R9 cần thêm các service tiền. Lấy từ CÙNG bộ tiêm phụ thuộc, cùng
    // lý do R1/R4 lấy `OrdersService` ở đây: đo mã thật, không đo bản chép.
    lay: <T>(duongDan: string, ten: string): T =>
      app.get(require(duongDan)[ten]) as T,
    dong: () => app.close() as Promise<void>,
  };
}
/* eslint-enable */

/** Đúng phần mặt tiền của từng service tiền mà R6..R9 gọi tới. */
interface DichVuKyQuy {
  createOrderEscrowsWithExternalFunding: (orderId: number) => Promise<unknown>;
  release: (orderId: number, sellerId?: number) => Promise<unknown>;
  refund: (orderId: number) => Promise<unknown>;
}

interface DichVuPayos {
  handleWebhook: (body: unknown) => Promise<unknown>;
}

interface DichVuThanhToan {
  create: (dto: unknown, user: unknown) => Promise<unknown>;
}

interface DichVuRutTien {
  create: (userId: number, dto: unknown) => Promise<{ id: number }>;
  approve: (id: number, adminId: number) => Promise<unknown>;
  reject: (id: number, adminId: number, note?: string) => Promise<unknown>;
}

interface DichVuSoCai {
  getOrCreateAccount: (
    ownerType: string,
    ownerId: number | null,
    purpose: string,
  ) => Promise<{ id: number | string }>;
  post: (input: unknown) => Promise<unknown>;
}

let failures = 0;
const results = new Map<string, boolean>();
const ok = (m: string) => console.log(`  \x1b[32m✓ PASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m  ${m}`);
};

/**
 * Chỗ ĐANG hỏng và đã biết. Bộ kiểm không chặn vì chúng, nhưng chặn nếu có chỗ
 * hỏng MỚI. Gỡ một dòng khỏi đây khi đã sửa xong — gỡ rồi mà vẫn đỏ thì CI chặn.
 */
const DA_BIET_HONG = new Set<string>([
  // TRỐNG — và giữ cho nó trống.
  //
  // Hai mục từng nằm ở đây, cả hai đều là task #2 bảng phân công:
  //
  //   R1 orders.create — bán quá số lượng
  //   R4 huỷ đơn chưa thanh toán — cộng kho nhiều lần
  //
  // Đã sửa ngày 02/09 trong `orders.service.ts`. Trước khi sửa, chạy bộ này
  // trên chính service thật cho ra: kho 1 → bán 20, còn **-19**; và huỷ 20 lượt
  // → kho về 20 trong khi đơn chỉ có 1 món. Sau khi sửa: bán 1 còn 0, và kho
  // về đúng 1.
  //
  // Danh sách trống nghĩa là MỌI kịch bản đua phải xanh. Thêm một dòng vào đây
  // là tự cho phép mình đi tiếp với một chỗ đua đã biết — chỉ làm thế khi việc
  // sửa thuộc người khác và có ghi rõ ai, như hai dòng vừa gỡ.
]);

/** Chờ một nhịp để mô phỏng công việc xen giữa lúc kiểm và lúc ghi. */
const nhip = (ms = 15) => new Promise((r) => setTimeout(r, ms));

async function dungSanPham(ds: DataSource, kho: number) {
  await ds.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of [
    'carts',
    'notifications',
    'order_items',
    'orders',
    'products',
    'categories',
    'users',
  ]) {
    await ds.query(`DELETE FROM ${t}`);
  }
  await ds.query('SET FOREIGN_KEY_CHECKS = 1');
  await ds.query(
    `INSERT INTO users (id, full_name, email, password, role)
     VALUES (1,'ban','s@race.local','x','seller')`,
  );
  await ds.query(`INSERT INTO categories (id, name, slug) VALUES (1,'dm','dm')`);
  await ds.query(
    `INSERT INTO products (id, name, slug, price, stock, seller_id, category_id, status)
     VALUES (1,'mon cuoi','mon-cuoi',1000,?,1,1,'active')`,
    [kho],
  );
}

/**
 * N người mua RIÊNG BIỆT, mỗi người một món trong giỏ, cùng trỏ vào sản phẩm 1.
 *
 * Phải là N người khác nhau chứ không phải một người bấm N lần: `orders.create`
 * đọc giỏ THEO NGƯỜI DÙNG, nên cùng một người thì hai lần gọi sẽ tranh nhau
 * cùng một dòng giỏ và ta lại đi đo một cuộc đua khác.
 */
async function dungNguoiMua(ds: DataSource): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < N; i++) {
    const uid = 100 + i;
    await ds.query(
      `INSERT INTO users (id, full_name, email, password, role)
       VALUES (?,?,?,'x','buyer')`,
      [uid, `mua ${i}`, `b${i}@race.local`],
    );
    await ds.query(
      `INSERT INTO carts (user_id, product_id, quantity) VALUES (?,1,1)`,
      [uid],
    );
    ids.push(uid);
  }
  return ids;
}

async function khoHienTai(ds: DataSource): Promise<number> {
  const r = await ds.query<Array<{ stock: number }>>(
    'SELECT stock FROM products WHERE id = 1',
  );
  return Number(r[0].stock);
}

/** Số tiền của đơn trong R6..R9. Nhỏ và tròn để đọc kết quả bằng mắt. */
const GIA_TIEN = 1000;
const NGUOI_MUA_TIEN = 100;

/**
 * Dọn các bảng tiền trước mỗi kịch bản R6..R9.
 *
 * `dungSanPham` chỉ dọn bảng hàng và đơn. Sổ cái, ký quỹ, payment, lệnh rút
 * mà để lại từ kịch bản trước thì số dư đầu vào không còn là 0, và phép so
 * "két giữ hộ = 0" ở cuối kịch bản sau đo nhầm cả phần tiền của kịch bản trước.
 */
async function donSachTien(ds: DataSource) {
  await ds.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of [
    'ledger_entries',
    'ledger_transactions',
    'ledger_accounts',
    'escrows',
    'payments',
    'withdrawals',
    'order_shipments',
  ]) {
    await ds.query(`DELETE FROM ${t}`);
  }
  await ds.query('SET FOREIGN_KEY_CHECKS = 1');
  await ds.query(
    `INSERT INTO users (id, full_name, email, password, role)
     VALUES (?, 'mua tien', 'tien@race.local', 'x', 'buyer')`,
    [NGUOI_MUA_TIEN],
  );
}

/** Một đơn một món (sản phẩm 1 của người bán 1), giá `GIA_TIEN`. */
async function taoDonTien(
  ds: DataSource,
  id: number,
  status: string,
  daTra: boolean,
  phuongThuc = 'cod',
) {
  await ds.query(
    `INSERT INTO orders (id, order_code, user_id, total_amount, final_amount, status,
                         payment_method, receiver_name, receiver_phone, shipping_address, is_paid)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'a', '0900000000', 'x', ?)`,
    [
      id,
      `ORD-TIEN-${id}`,
      NGUOI_MUA_TIEN,
      GIA_TIEN,
      GIA_TIEN,
      status,
      phuongThuc,
      daTra ? 1 : 0,
    ],
  );
  await ds.query(
    `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
     VALUES (?, 1, 'mon cuoi', ?, 1, ?)`,
    [id, GIA_TIEN, GIA_TIEN],
  );
}

/** Số dư một tài khoản sổ cái, đọc thẳng bảng. Chưa có tài khoản = 0. */
async function soDu(
  ds: DataSource,
  ownerType: string,
  ownerId: number | null,
  purpose: string,
): Promise<bigint> {
  const r = await ds.query<Array<{ balance: string | number }>>(
    `SELECT balance FROM ledger_accounts
     WHERE owner_type = ? AND purpose = ? AND ${
       ownerId === null ? 'owner_id IS NULL' : 'owner_id = ?'
     }`,
    ownerId === null ? [ownerType, purpose] : [ownerType, purpose, ownerId],
  );
  return r.length ? BigInt(String(r[0].balance)) : 0n;
}

/** Chạy `ham` N lần đồng thời, nuốt lỗi lẻ, trả về số lần "thành công". */
async function dongThoi(
  ham: (i: number) => Promise<boolean>,
): Promise<number> {
  const kq = await Promise.all(
    Array.from({ length: N }, (_, i) => ham(i).catch(() => false)),
  );
  return kq.filter(Boolean).length;
}

/** Ghi kết quả một kịch bản; `dat` = true nghĩa là hệ thống giữ được bất biến. */
function chot(ten: string, dat: boolean, chiTiet: string) {
  results.set(ten, dat);
  if (dat) ok(`${ten} — ${chiTiet}`);
  else bad(`${ten} — ${chiTiet}`);
}

async function main() {
  console.log('\x1b[1m═══ TỰ KIỂM ĐUA — nhiều người cùng lúc ═══\x1b[0m');
  const ds = await AppDataSource.initialize();
  const { svc, lay, dong } = await layDichVuDon();
  console.log(`Kết nối DB: ${ds.options.database} · ${N} người đồng thời\n`);

  // ── R1: gọi THẲNG orders.create ───────────────────────────────────────────
  //
  // 20 người mua khác nhau, mỗi người một dòng giỏ, cùng trỏ vào món hàng cuối
  // cùng. Bước hỏi phí ship GHN đã được thay bằng số cố định ở `layDichVuDon`:
  // bài kiểm này đo khoá trong database chứ không đo đường truyền.
  console.log('\x1b[1mR1 · Hai mươi người mua món hàng cuối cùng\x1b[0m');
  await dungSanPham(ds, 1);
  const nguoiMua = await dungNguoiMua(ds);
  const muaR1 = await dongThoi(async (i) => {
    await svc.create(
      {
        receiver_name: 'Nguoi mua',
        receiver_phone: '0900000000',
        shipping_address: 'So 1 duong Dua',
        payment_method: 'cod',
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
      },
      { id: nguoiMua[i], role: 'buyer' },
    );
    return true;
  });
  const khoR1 = await khoHienTai(ds);
  chot(
    'R1 orders.create — bán quá số lượng',
    khoR1 >= 0 && muaR1 <= 1,
    `kho 1 → bán ${muaR1}, còn ${khoR1}${khoR1 < 0 ? ' (ÂM KHO)' : ''}`,
  );

  // ── R2: ĐỐI CHỨNG — cùng kịch bản, chỉ thêm khoá ──────────────────────────
  //
  // Nếu mục này cũng đỏ thì bài kiểm sai chứ không phải mã sai.
  console.log('\n\x1b[1mR2 · [ĐỐI CHỨNG] cùng kịch bản, có SELECT ... FOR UPDATE\x1b[0m');
  await dungSanPham(ds, 1);
  const muaR2 = await dongThoi(async () => {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // `QueryRunner.query` không nhận tham số kiểu như `DataSource.query`.
      const r = (await qr.query(
        'SELECT stock FROM products WHERE id = 1 FOR UPDATE',
      )) as Array<{ stock: number }>;
      if (Number(r[0].stock) < 1) {
        await qr.rollbackTransaction();
        return false;
      }
      await nhip();
      await qr.query('UPDATE products SET stock = stock - 1 WHERE id = 1');
      await qr.commitTransaction();
      return true;
    } catch {
      await qr.rollbackTransaction();
      return false;
    } finally {
      await qr.release();
    }
  });
  const khoR2 = await khoHienTai(ds);
  chot(
    'R2 [đối chứng] khoá hàng bằng FOR UPDATE',
    khoR2 === 0 && muaR2 === 1,
    `kho 1 → bán ${muaR2}, còn ${khoR2}`,
  );

  // ── R3: ĐỐI CHỨNG — khoá chống trùng của sổ cái ───────────────────────────
  //
  // `ledger_transactions.idempotency_key` là UNIQUE ở tầng database. Đây là lá
  // chắn thật của mọi đường tiền: hai lượt hoàn/giải ngân cùng một escrow sinh
  // cùng một khoá, nên lượt thứ hai bị database từ chối — bất kể tầng trên có
  // quên khoá dòng hay không.
  //
  // Mục này tồn tại để chứng minh điều đó CÓ THẬT, chứ không phải tin lời chú
  // thích. Nó cũng là lý do vì sao "hoàn tiền hai lần" KHÔNG nằm trong danh
  // sách hỏng: đường tiền được chặn ở đây.
  console.log('\n\x1b[1mR3 · [ĐỐI CHỨNG] khoá chống trùng của sổ cái\x1b[0m');
  await ds.query('DELETE FROM ledger_entries');
  await ds.query('DELETE FROM ledger_transactions');
  const KHOA = 'escrow_refund:race-test';
  const ghiR3 = await dongThoi(async () => {
    await ds.query(
      `INSERT INTO ledger_transactions (idempotency_key, type, reference_type, reference_id)
       VALUES (?, 'escrow_refund', 'escrow', 1)`,
      [KHOA],
    );
    return true;
  });
  const demR3 = await ds.query<Array<{ n: number }>>(
    'SELECT COUNT(*) AS n FROM ledger_transactions WHERE idempotency_key = ?',
    [KHOA],
  );
  chot(
    'R3 [đối chứng] idempotency_key chặn ghi trùng',
    Number(demR3[0].n) === 1 && ghiR3 === 1,
    `${N} lượt ghi cùng khoá → còn ${demR3[0].n} bản ghi`,
  );

  // ── R4: huỷ đơn CHƯA thanh toán, hai lượt cùng lúc ────────────────────────
  //
  // `applyCancellation` cộng hàng về kho trong transaction. Với đơn ĐÃ thanh
  // toán, lượt thứ hai chết ở khoá chống trùng của sổ cái (R3) nên cả
  // transaction quay lui — kho không bị cộng hai lần.
  //
  // Nhưng nhánh hoàn tiền chỉ chạy `if (order.is_paid)`. Đơn CHƯA thanh toán
  // không sinh bút toán nào, nên không có gì chặn: hai lượt huỷ đồng thời đều
  // cộng kho. Không mất tiền, nhưng kho phình ra hàng không có thật — người mua
  // đặt được món đã hết.
  console.log('\n\x1b[1mR4 · Huỷ đơn CHƯA thanh toán, hai lượt cùng lúc\x1b[0m');
  await dungSanPham(ds, 0);
  await ds.query(
    `INSERT INTO orders (id, order_code, user_id, final_amount, status,
                         receiver_name, receiver_phone, shipping_address, is_paid)
     VALUES (1,'ORD-RACE',1,1000,'pending','a','0900000000','x',0)`,
  );
  // Gọi THẲNG `cancelExpired` — đúng đường mà cron huỷ đơn quá hạn đi qua, và
  // nó dùng chung `applyCancellation` với nút "Huỷ đơn" của người dùng.
  await ds.query(
    `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
     VALUES (1, 1, 'mon cuoi', 1000, 1, 1000)`,
  );
  const huyR4 = await dongThoi(async () => {
    await svc.cancelExpired(1);
    return true;
  });
  const khoR4 = await khoHienTai(ds);
  chot(
    'R4 huỷ đơn chưa thanh toán — cộng kho nhiều lần',
    khoR4 <= 1,
    `huỷ ${huyR4} lượt → kho về ${khoR4} (đúng phải là 1)`,
  );

  // ── R5: MỘT NGƯỜI BẤM "ĐẶT HÀNG" N LẦN CÙNG LÚC ──────────────────────────
  //
  // R1 cố ý dùng N người KHÁC NHAU — comment ở `dungNguoiMua` nói rõ vì sao:
  // "một người bấm N lần thì ta lại đi đo một cuộc đua khác". Đây chính là
  // cuộc đua khác đó, và chưa ai đo nó.
  //
  // Kịch bản thật: mạng chập, người mua bấm lại; hoặc nút không bị khoá sau
  // lần bấm đầu; hoặc trình duyệt tự gửi lại. `docs/BAN-GIAO.md` ghi nó trong
  // mục việc còn lại: "Idempotency ở đặt hàng — bấm hai lần tạo hai đơn.
  // Tiền thì sổ cái che, đơn thì không."
  //
  // VÌ SAO KHO KHÔNG CỨU ĐƯỢC. Kho ở đây để 50, nên cả N lượt đều qua được
  // cửa `stock >= n`. Bất biến bị vi phạm không phải "kho âm" mà là "một lần
  // bấm, một đơn" — người mua bị tính tiền hai lần cho cùng một giỏ.
  //
  // VÌ SAO GIỎ KHÔNG CỨU ĐƯỢC. `orders.create` xoá giỏ ở CUỐI transaction.
  // Bấm tuần tự thì lần hai thấy giỏ trống và trả 400 sạch sẽ. Nhưng bấm
  // ĐỒNG THỜI thì cả N lượt đều đọc giỏ trước khi ai kịp commit.
  console.log(
    '\n\x1b[1mR5 · Một người bấm "Đặt hàng" nhiều lần cùng lúc\x1b[0m',
  );
  await dungSanPham(ds, 50);
  await ds.query(
    `INSERT INTO users (id, full_name, email, password, role)
     VALUES (200,'mua lap','lap@race.local','x','buyer')`,
  );
  await ds.query(
    `INSERT INTO carts (user_id, product_id, quantity) VALUES (200,1,1)`,
  );

  await dongThoi(async () => {
    await svc.create(
      {
        receiver_name: 'Nguoi mua',
        receiver_phone: '0900000000',
        shipping_address: 'So 1 duong Dua',
        payment_method: 'cod',
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
      },
      { id: 200, role: 'buyer' },
    );
    return true;
  });

  const donR5 = await ds.query<Array<{ n: number }>>(
    'SELECT COUNT(*) AS n FROM orders WHERE user_id = 200',
  );
  const soDonR5 = Number(donR5[0].n);
  const khoR5 = await khoHienTai(ds);
  chot(
    'R5 orders.create — một người bấm nhiều lần, một giỏ',
    soDonR5 === 1 && khoR5 === 49,
    `${N} lượt bấm → ${soDonR5} đơn (đúng phải là 1), kho còn ${khoR5} (đúng phải là 49)`,
  );

  // ── R6: GIẢI NGÂN VÀ HOÀN TIỀN CÙNG LÚC TRÊN MỘT ĐƠN ĐÃ TRẢ ──────────────
  //
  // Người mua bấm "đã nhận hàng" (giải ngân cho người bán) và "huỷ đơn" (hoàn
  // tiền cho mình) cùng lúc. Hai đường dùng HAI khoá chống trùng khác nhau
  // (`escrow_release:` và `escrow_refund:`), nên R3 không che được: thứ duy
  // nhất đứng giữa là khoá dòng ký quỹ trong `EscrowsService`. Thiếu khoá thì
  // cả hai cùng thấy `holding`, tiền đi cả hai đường và két giữ hộ âm.
  //
  // Gọi thẳng tầng ký quỹ, không qua `confirmShipmentReceived`/`cancel`: từ
  // khi huỷ bị chặn với đơn có vận đơn GHN đang đi, hai nút đó hiếm khi cùng
  // hợp lệ, nhưng tầng ký quỹ vẫn phải tự đứng vững (`autoConfirmDueShipments`
  // cũng gọi `release` mà không qua đơn).
  console.log(
    '\n\x1b[1mR6 · Giải ngân và hoàn tiền cùng lúc trên một đơn đã trả\x1b[0m',
  );
  const kyQuy = lay<DichVuKyQuy>(
    '../src/money/escrows/escrows.service',
    'EscrowsService',
  );
  await dungSanPham(ds, 5);
  await donSachTien(ds);
  await taoDonTien(ds, 1, 'confirmed', true);
  await kyQuy.createOrderEscrowsWithExternalFunding(1);
  await dongThoi(async (i) => {
    if (i % 2) await kyQuy.release(1, 1);
    else await kyQuy.refund(1);
    return true;
  });
  const banNhanR6 = await soDu(ds, 'user', 1, 'available');
  const muaNhanR6 = await soDu(ds, 'user', NGUOI_MUA_TIEN, 'available');
  const ketR6 = await soDu(ds, 'platform', null, 'escrow_hold');
  chot(
    'R6 ký quỹ: giải ngân và hoàn tiền cùng lúc',
    banNhanR6 > 0n !== muaNhanR6 > 0n && ketR6 === 0n,
    `người bán nhận ${banNhanR6}, người mua được hoàn ${muaNhanR6}, két giữ hộ ${ketR6} ` +
      '(đúng: chỉ một bên nhận, két về 0)',
  );

  // ── R7: PayOS GỬI CÙNG MỘT WEBHOOK N LẦN CÙNG LÚC ───────────────────────
  //
  // PayOS gửi lại webhook khi không nhận được 200 kịp, và `refreshOrderStatus`
  // đi cùng một đường. Mỗi lượt đọc payment thấy `pending` (đọc không khoá),
  // nên cả N lượt đều đi tới `applyPaidPayment`. Thứ chặn ghi trùng là khoá
  // chống trùng TẤT ĐỊNH `payos:<orderCode>:<paymentLinkId>` (cùng cơ chế R3)
  // cộng khoá dòng đơn: lượt sau thấy đơn đã trả thì cũng chỉ còn ghi được
  // đúng khoá đó, và bị UNIQUE từ chối.
  //
  // Gọi `handleWebhook` thật. Chỉ thay đúng bước kiểm chữ ký (cần khoá
  // checksum thật của PayOS), và trả lại nguyên bản ngay sau kịch bản.
  console.log('\n\x1b[1mR7 · Cùng một webhook PayOS tới N lần cùng lúc\x1b[0m');
  const payos = lay<DichVuPayos>(
    '../src/money/payos/payos.service',
    'PayosService',
  );
  // Từ b250e7b, thiếu PAYOS_CHECKSUM_KEY thì handleWebhook từ chối TRƯỚC khi
  // tới SDK (cờ webhookKhongCoKhoa). Môi trường tự kiểm không có khoá thật, nên
  // ngoài việc thay SDK còn phải tạm hạ cờ đó; không thì R7 đỏ vì 0 bút toán
  // chứ không phải vì ghi trùng. Trả lại cả hai ngay sau kịch bản.
  const vo = payos as unknown as { payos: unknown; webhookKhongCoKhoa: boolean };
  const payosGoc = vo.payos;
  const coGoc = vo.webhookKhongCoKhoa;
  vo.webhookKhongCoKhoa = false;
  vo.payos = {
    webhooks: {
      verify: (body: { data: unknown }) => Promise.resolve(body.data),
    },
  };
  await dungSanPham(ds, 5);
  await donSachTien(ds);
  await taoDonTien(ds, 1, 'pending', false, 'payos');
  await ds.query(
    `INSERT INTO payments (order_id, user_id, amount, payment_method, status, type,
                           payos_order_code, payos_payment_link_id)
     VALUES (1, ?, ?, 'payos', 'pending', 'order_payment', '1', 'link-1')`,
    [NGUOI_MUA_TIEN, GIA_TIEN],
  );
  try {
    await dongThoi(async () => {
      await payos.handleWebhook({
        success: true,
        data: {
          orderCode: 1,
          paymentLinkId: 'link-1',
          code: '00',
          reference: 'REF-R7',
        },
      });
      return true;
    });
  } finally {
    vo.payos = payosGoc;
    vo.webhookKhongCoKhoa = coGoc;
  }
  const butToanR7 = await ds.query<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM ledger_transactions
     WHERE reference_type = 'order' AND reference_id = '1'`,
  );
  const donR7 = await ds.query<Array<{ status: string; is_paid: number }>>(
    'SELECT status, is_paid FROM orders WHERE id = 1',
  );
  const ketR7 = await soDu(ds, 'platform', null, 'escrow_hold');
  const viR7 = await soDu(ds, 'user', NGUOI_MUA_TIEN, 'available');
  const soButToanR7 = Number(butToanR7[0].n);
  chot(
    'R7 webhook PayOS: cùng một lần trả tiền gửi tới nhiều lần',
    soButToanR7 === 1 &&
      ketR7 === BigInt(GIA_TIEN) &&
      viR7 === 0n &&
      donR7[0].status === 'confirmed' &&
      Number(donR7[0].is_paid) === 1,
    `${N} webhook → ${soButToanR7} bút toán (đúng: 1), két ${ketR7}, ví người mua ${viR7}, ` +
      `đơn ${donR7[0].status}/is_paid=${donR7[0].is_paid}`,
  );

  // ── R8: MỘT VÍ, NHIỀU ĐƠN, TRẢ CÙNG LÚC ─────────────────────────────────
  //
  // Ví người mua có đúng tiền cho MỘT đơn. Người mua mở N đơn khác nhau
  // trên nhiều tab và bấm "trả bằng ví" ở tất cả cùng lúc. Mỗi đơn có khoá
  // chống trùng riêng (`order_pay:<id>`), nên R3 không che được: thứ duy nhất
  // chặn là `LedgerService.post` khoá tài khoản ví (`FOR UPDATE`) rồi mới kiểm
  // "không được âm". Thiếu khoá thì mọi lượt cùng đọc thấy đủ tiền, nhiều đơn
  // cùng được trả bằng một lần tiền.
  console.log('\n\x1b[1mR8 · Một ví, nhiều đơn, trả bằng ví cùng lúc\x1b[0m');
  const thanhToan = lay<DichVuThanhToan>(
    '../src/money/payments/payments.service',
    'PaymentsService',
  );
  const soCai = lay<DichVuSoCai>(
    '../src/money/ledger/ledger.service',
    'LedgerService',
  );
  await dungSanPham(ds, 50);
  await donSachTien(ds);
  for (let i = 1; i <= N; i++) {
    await taoDonTien(ds, i, 'pending', false, 'wallet');
  }
  const congNap = await soCai.getOrCreateAccount(
    'external',
    null,
    'gateway_clearing',
  );
  const viMua = await soCai.getOrCreateAccount(
    'user',
    NGUOI_MUA_TIEN,
    'available',
  );
  await soCai.post({
    idempotencyKey: 'race:r8:nap',
    type: 'topup',
    entries: [
      { accountId: Number(congNap.id), amount: -BigInt(GIA_TIEN) },
      { accountId: Number(viMua.id), amount: BigInt(GIA_TIEN) },
    ],
  });
  const traR8 = await dongThoi(async (i) => {
    await thanhToan.create(
      { order_id: i + 1, payment_method: 'wallet' },
      { id: NGUOI_MUA_TIEN, role: 'buyer' },
    );
    return true;
  });
  const daTraR8 = await ds.query<Array<{ n: number }>>(
    'SELECT COUNT(*) AS n FROM orders WHERE is_paid = 1',
  );
  // Số dư thấp nhất từng xuất hiện trong sổ của ví, không chỉ số dư cuối:
  // "chưa bao giờ âm" là bất biến, "cuối cùng không âm" thì chưa đủ.
  const thapNhatR8 = await ds.query<Array<{ m: string | number | null }>>(
    `SELECT MIN(e.balance_after) AS m FROM ledger_entries e
     JOIN ledger_accounts a ON a.id = e.account_id
     WHERE a.owner_type = 'user' AND a.owner_id = ? AND a.purpose = 'available'`,
    [NGUOI_MUA_TIEN],
  );
  const viR8 = await soDu(ds, 'user', NGUOI_MUA_TIEN, 'available');
  const ketR8 = await soDu(ds, 'platform', null, 'escrow_hold');
  const soDonTraR8 = Number(daTraR8[0].n);
  const thapNhat = BigInt(String(thapNhatR8[0].m ?? 0));
  chot(
    'R8 trả bằng ví: nhiều đơn, một ví chỉ đủ một đơn',
    traR8 === 1 && soDonTraR8 === 1 && viR8 === 0n && thapNhat >= 0n &&
      ketR8 === BigInt(GIA_TIEN),
    `${N} đơn trả cùng lúc → ${traR8} lượt thành công, ${soDonTraR8} đơn đã trả (đúng: 1), ` +
      `ví còn ${viR8}, thấp nhất ${thapNhat}, két ${ketR8}`,
  );

  // ── R9: HAI ADMIN, MỘT LỆNH RÚT: DUYỆT VÀ TỪ CHỐI CÙNG LÚC ──────────────
  //
  // Hai admin cùng mở một lệnh rút đang chờ. Từ chối là trả tiền về ví người
  // bán; duyệt là hứa sẽ chuyển khoản. Không khoá thì cả hai cùng thấy
  // `pending` và cùng "thành công": tiền đã về ví theo lượt từ chối mà lệnh
  // lại nằm ở `approved` theo lượt ghi sau, và admin đi chuyển khoản thật cho
  // một khoản người bán vẫn còn tiêu được.
  console.log(
    '\n\x1b[1mR9 · Hai admin duyệt và từ chối một lệnh rút cùng lúc\x1b[0m',
  );
  const rutTien = lay<DichVuRutTien>(
    '../src/money/withdrawals/withdrawals.service',
    'WithdrawalsService',
  );
  const SO_RUT = 100_000;
  await dungSanPham(ds, 5);
  await donSachTien(ds);
  await ds.query(
    `INSERT INTO users (id, full_name, email, password, role)
     VALUES (2, 'quan tri', 'admin@race.local', 'x', 'admin')`,
  );
  const congR9 = await soCai.getOrCreateAccount(
    'external',
    null,
    'gateway_clearing',
  );
  const viBanR9 = await soCai.getOrCreateAccount('user', 1, 'available');
  await soCai.post({
    idempotencyKey: 'race:r9:nap',
    type: 'topup',
    entries: [
      { accountId: Number(congR9.id), amount: -BigInt(SO_RUT) },
      { accountId: Number(viBanR9.id), amount: BigInt(SO_RUT) },
    ],
  });
  const lenh = await rutTien.create(1, {
    amount: SO_RUT,
    bank_name: 'VCB',
    bank_account: '0123456789',
    bank_holder: 'NGUOI BAN',
  });
  const thangR9 = await dongThoi(async (i) => {
    if (i % 2) await rutTien.approve(lenh.id, 2);
    else await rutTien.reject(lenh.id, 2, 'race r9');
    return true;
  });
  const lenhR9 = await ds.query<Array<{ status: string }>>(
    'SELECT status FROM withdrawals WHERE id = ?',
    [lenh.id],
  );
  const conR9 = await soDu(ds, 'user', 1, 'available');
  const giuR9 = await soDu(ds, 'user', 1, 'withdrawal_pending');
  const trangThaiR9 = lenhR9[0].status;
  // Tiền phải đứng đúng chỗ theo bên thắng, và không đồng nào sinh thêm.
  const tienDungCho =
    (trangThaiR9 === 'approved' && giuR9 === BigInt(SO_RUT) && conR9 === 0n) ||
    (trangThaiR9 === 'rejected' && conR9 === BigInt(SO_RUT) && giuR9 === 0n);
  chot(
    'R9 rút tiền: duyệt và từ chối cùng lúc',
    thangR9 === 1 && tienDungCho,
    `${N} lượt → ${thangR9} lượt thành công (đúng: 1), lệnh ${trangThaiR9}, ` +
      `ví ${conR9}, đang giữ ${giuR9}`,
  );

  await ds.destroy();

  // ── Tổng kết theo kiểu bánh cóc ──────────────────────────────────────────
  console.log('\n\x1b[1m═══ TỔNG KẾT ═══\x1b[0m');
  const hongMoi: string[] = [];
  const daSua: string[] = [];
  for (const [ten, dat] of results) {
    if (!dat && !DA_BIET_HONG.has(ten)) hongMoi.push(ten);
    if (dat && DA_BIET_HONG.has(ten)) daSua.push(ten);
  }

  for (const t of daSua) {
    console.log(
      `  \x1b[33m↑ ĐÃ SỬA\x1b[0m  ${t} — gỡ khỏi DA_BIET_HONG trong file này`,
    );
  }
  for (const t of DA_BIET_HONG) {
    if (results.get(t) === false) {
      console.log(`  \x1b[2m· đã biết hỏng\x1b[0m  ${t}`);
    }
  }

  // Đóng app trước khi thoát: `createApplicationContext` giữ pool kết nối và
  // hàng đợi BullMQ, không đóng thì tiến trình treo thay vì trả mã.
  await dong();
  // Có điều kiện: `app.close()` đóng luôn kết nối mang tên "default", mà đó
  // cũng chính là tên của AppDataSource. Gọi `destroy()` lần nữa thì nổ
  // CannotExecuteNotConnectedError sau khi đã in xong kết quả — báo đỏ giả.
  if (ds.isInitialized) await ds.destroy();

  if (hongMoi.length) {
    console.log(`\n\x1b[31m═══ ${hongMoi.length} CHỖ ĐUA MỚI ═══\x1b[0m`);
    for (const t of hongMoi) console.log(`  ${t}`);
    process.exit(1);
  }
  console.log(
    `\n\x1b[32m═══ Không có chỗ đua MỚI (${DA_BIET_HONG.size} chỗ đã biết, xem DA_BIET_HONG) ═══\x1b[0m`,
  );
  process.exit(0);
}

void main();
