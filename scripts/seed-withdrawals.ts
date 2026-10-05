/**
 * Tạo lệnh rút tiền mẫu để demo và để kiểm giao diện quản trị.
 *
 * Vì sao không INSERT thẳng vào bảng `withdrawals`: gửi lệnh rút là một lần
 * chuyển tiền trong sổ cái (`available` → `withdrawal_pending`). Thêm hàng vào
 * bảng mà không ghi bút toán thì bảng nói người bán đang chờ rút, còn sổ cái
 * nói tiền vẫn nằm trong ví — hai nguồn sự thật lệch nhau ngay từ dòng đầu
 * tiên, đúng loại lỗi cả dự án đang cố gắng loại bỏ.
 *
 * Nên script này gọi thẳng WithdrawalsService, cùng đúng đường mà nút bấm trên
 * giao diện đi qua.
 *
 * Chạy:
 *   npm run seed:withdrawals
 *
 * Chạy lại nhiều lần được: nếu người bán đã có lệnh đang chờ thì thoát, không
 * tạo thêm. (Seed escrow trước đây từng nhân đôi dữ liệu vì thiếu đúng bước
 * kiểm này.)
 */
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WithdrawalsService } from '@money/withdrawals/withdrawals.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  const ds = app.get(DataSource);
  const svc = app.get(WithdrawalsService);

  const holders = await ds.query(`
    SELECT a.owner_id AS user_id, u.email, u.full_name,
           (SELECT COALESCE(SUM(e.amount), 0)
              FROM ledger_entries e WHERE e.account_id = a.id) AS bal
      FROM ledger_accounts a
      JOIN users u ON u.id = a.owner_id
     WHERE a.owner_type = 'user' AND a.purpose = 'available'
    HAVING bal > 0
     ORDER BY bal DESC
  `);

  if (holders.length === 0) {
    console.log('Chưa ai có số dư khả dụng. Chạy `npm run seed` trước.');
    await app.close();
    return;
  }

  const seller = holders[0];
  console.log(
    `Người bán: #${seller.user_id} ${seller.email} — ${seller.bal} đ`,
  );

  const [existing] = await ds.query(
    `SELECT COUNT(*) AS n FROM withdrawals
      WHERE user_id = ? AND status IN ('pending','approved')`,
    [seller.user_id],
  );
  if (Number(existing.n) > 0) {
    console.log(`Đã có ${existing.n} lệnh đang chờ. Không tạo thêm.`);
    await app.close();
    return;
  }

  const bal = BigInt(seller.bal);
  const first = bal / 4n;
  const second = bal / 5n;

  const a = await svc.create(Number(seller.user_id), {
    amount: Number(first),
    bank_name: 'Vietcombank',
    bank_account: '0071000123456',
    bank_holder: String(seller.full_name || 'CHU TAI KHOAN').toUpperCase(),
  });
  console.log(`Lệnh #${a.id} — ${first} đ — chờ duyệt`);

  const b = await svc.create(Number(seller.user_id), {
    amount: Number(second),
    bank_name: 'Techcombank',
    bank_account: '19036666888',
    bank_holder: String(seller.full_name || 'CHU TAI KHOAN').toUpperCase(),
  });

  // Đẩy cái thứ hai sang `approved` để bảng quản trị có cả hai nhánh thao tác:
  // một lệnh chờ duyệt (Duyệt / Từ chối) và một lệnh chờ chuyển khoản (Đã
  // chuyển khoản). Demo mà chỉ có một trạng thái thì không thấy được vòng đời.
  const [admin] = await ds.query(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`,
  );
  if (admin) {
    await svc.approve(b.id, admin.id);
    console.log(`Lệnh #${b.id} — ${second} đ — đã duyệt, chờ chuyển khoản`);
  } else {
    console.log(
      `Lệnh #${b.id} — ${second} đ — chờ duyệt (không tìm thấy admin)`,
    );
  }

  const [sum] = await ds.query(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM ledger_entries`,
  );
  console.log(`Bất biến sổ cái: SUM(entries) = ${sum.s} (phải bằng 0)`);
  if (Number(sum.s) !== 0) {
    console.error('SỔ CÁI LỆCH. Dừng lại và tìm nguyên nhân trước khi demo.');
    await app.close();
    process.exit(1);
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
