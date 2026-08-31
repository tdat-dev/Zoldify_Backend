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

const N = 20; // số người "bấm" cùng lúc

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
  // Task #2 bảng phân công (vai A, hạn 12/08): "SELECT ... FOR UPDATE trong
  // orders.create, chặn kho về âm". Chưa làm — orders.service.ts đọc stock ở
  // dòng 151, kiểm, rồi mãi dòng 249 mới decrement, không transaction, không
  // khoá, không điều kiện `WHERE stock >= n`.
  'R1 orders.create — bán quá số lượng',

  // Cùng gốc với R1, cùng file, cùng chủ (vai A): `applyCancellation` cộng hàng
  // về kho mà không khoá dòng đơn. Với đơn ĐÃ thanh toán thì khoá chống trùng
  // của sổ cái (R3) cứu — lượt thứ hai chết ở đó nên cả transaction quay lui.
  // Đơn CHƯA thanh toán không sinh bút toán nào nên không có gì chặn.
  //
  // Kích hoạt thật: người mua bấm "Huỷ đơn" hai lần, hoặc client tự gửi lại khi
  // timeout. Không mất tiền, nhưng kho phình ra hàng không có thật — và người
  // sau đặt được món đã hết.
  'R4 huỷ đơn chưa thanh toán — cộng kho nhiều lần',
]);

/** Chờ một nhịp để mô phỏng công việc xen giữa lúc kiểm và lúc ghi. */
const nhip = (ms = 15) => new Promise((r) => setTimeout(r, ms));

async function dungSanPham(ds: DataSource, kho: number) {
  await ds.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['order_items', 'orders', 'products', 'categories', 'users']) {
    await ds.query(`DELETE FROM ${t}`);
  }
  await ds.query('SET FOREIGN_KEY_CHECKS = 1');
  await ds.query(
    `INSERT INTO users (id, full_name, email, password, role)
     VALUES (1,'ban','s@race.local','x','seller')`,
  );
  await ds.query(`INSERT INTO categories (id, name, slug) VALUES (1,'dm','dm')`);
  await ds.query(
    `INSERT INTO products (id, name, slug, price, stock, seller_id, category_id)
     VALUES (1,'mon cuoi','mon-cuoi',1000,?,1,1)`,
    [kho],
  );
}

async function khoHienTai(ds: DataSource): Promise<number> {
  const r = await ds.query<Array<{ stock: number }>>(
    'SELECT stock FROM products WHERE id = 1',
  );
  return Number(r[0].stock);
}

/** Chạy `ham` N lần đồng thời, nuốt lỗi lẻ, trả về số lần "thành công". */
async function dongThoi(ham: () => Promise<boolean>): Promise<number> {
  const kq = await Promise.all(
    Array.from({ length: N }, () => ham().catch(() => false)),
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
  console.log(`Kết nối DB: ${ds.options.database} · ${N} người đồng thời\n`);

  // ── R1: đúng khuôn orders.create đang dùng ────────────────────────────────
  //
  // Tái hiện trình tự thật: đọc stock (orders.service.ts:151) → kiểm → làm việc
  // khác → decrement không điều kiện (dòng 249). KHÔNG gọi thẳng OrdersService
  // vì lớp đó có mười phụ thuộc; nhưng trình tự thì y nguyên, và trình tự mới
  // là thứ quyết định đúng/sai ở đây.
  console.log('\x1b[1mR1 · Hai mươi người mua món hàng cuối cùng\x1b[0m');
  await dungSanPham(ds, 1);
  const muaR1 = await dongThoi(async () => {
    const s = await khoHienTai(ds);
    if (s < 1) return false;
    await nhip();
    await ds.query('UPDATE products SET stock = stock - 1 WHERE id = 1');
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
  const huyR4 = await dongThoi(async () => {
    const r = await ds.query<Array<{ status: string }>>(
      'SELECT status FROM orders WHERE id = 1',
    );
    if (r[0].status !== 'pending') return false;
    await nhip();
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`UPDATE orders SET status = 'cancelled' WHERE id = 1`);
      await qr.query('UPDATE products SET stock = stock + 1 WHERE id = 1');
      await qr.commitTransaction();
      return true;
    } catch {
      await qr.rollbackTransaction();
      return false;
    } finally {
      await qr.release();
    }
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
