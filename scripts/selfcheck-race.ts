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
  return {
    svc: app.get(OrdersService) as DichVuDon,
    dong: () => app.close() as Promise<void>,
  };
}
/* eslint-enable */

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
  const { svc, dong } = await layDichVuDon();
  console.log(`Kết nối DB: ${ds.options.database} · ${N} người đồng thời\n`);

  // ── R1: gọi THẲNG orders.create ───────────────────────────────────────────
  //
  // 20 người mua khác nhau, mỗi người một dòng giỏ, cùng trỏ vào món hàng cuối
  // cùng. Không truyền `ghn_district_id`/`ghn_ward_code` để `create` bỏ qua
  // bước hỏi phí ship — đây là lời gọi mạng ra GHN, và bài kiểm này đo khoá
  // trong database chứ không đo đường truyền.
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
