import { DataSource } from 'typeorm';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { LedgerDoiSoatService } from './ledger-doi-soat.service';

/**
 * Trang đối soát sổ cái — bài kiểm chạy trên MySQL THẬT.
 *
 * Bất biến do database giữ:
 *  1. SUM(amount) của toàn bộ ledger_entries = 0 (mỗi giao dịch ≥2 bút toán tổng = 0)
 *  2. Với mỗi tài khoản: ledger_accounts.balance = SUM(amount) các bút toán của nó
 *     balance là cache, lệch nghĩa là có đường ghi sửa balance mà không ghi bút toán.
 *
 * Mock đi thì bài kiểm xanh mà không chứng minh gì. Chép khuôn DataSource từ
 * ledger.service.spec.ts.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('LedgerDoiSoatService — đối soát sổ cái', () => {
  let dataSource: DataSource;
  let ledger: LedgerService;
  let doiSoat: LedgerDoiSoatService;

  // Dải id ngẫu nhiên để bài kiểm chạy được lần 2
  const ID_BASE = 9_000_000 + Math.floor(Math.random() * 1_000_000);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [LedgerAccount, LedgerTransaction, LedgerEntry],
      synchronize: true,
      logging: false,
    });

    try {
      await dataSource.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}.\n` +
          `Chạy: docker run -d --name zoldify-test-mysql ` +
          `-e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=zoldify_test ` +
          `-p 3307:3306 mysql:8\n` +
          `Lỗi gốc: ${(err as Error).message}`,
      );
    }

    ledger = new LedgerService(dataSource);
    doiSoat = new LedgerDoiSoatService(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    // Xoá theo thứ tự khoá ngoại
    await dataSource.query('DELETE FROM ledger_entries');
    await dataSource.query('DELETE FROM ledger_transactions');
    await dataSource.query('DELETE FROM ledger_accounts');
  });

  it('sổ cái rỗng → cân, tổng = 0, không tài khoản lệch', async () => {
    const kq = await doiSoat.doiSoat();
    expect(kq.can_bang).toBe(true);
    expect(kq.tong_but_toan).toBe('0');
    expect(kq.so_tai_khoan_lech).toBe(0);
    expect(kq.tai_khoan_lech).toHaveLength(0);
  });

  it('một giao dịch hợp lệ hai chân → vẫn cân, không tài khoản lệch', async () => {
    // Nạp 100000 vào platform/escrow_hold (hai chân: gateway_clearing -100000, escrow_hold +100000)
    const gateway = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    const escrow = await ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

    await ledger.post({
      idempotencyKey: `test-topup-${ID_BASE}`,
      type: LedgerTxType.TOPUP,
      entries: [
        { accountId: Number(gateway.id), amount: -100_000n },
        { accountId: Number(escrow.id), amount: 100_000n },
      ],
    });

    const kq = await doiSoat.doiSoat();
    expect(kq.can_bang).toBe(true);
    expect(kq.tong_but_toan).toBe('0');
    expect(kq.so_tai_khoan_lech).toBe(0);
    expect(kq.tai_khoan_lech).toHaveLength(0);
    // tong_dang_giu_ho phải bằng số dư platform/escrow_hold
    expect(kq.tong_dang_giu_ho).toBe('100000');
  });

  it('phá có chủ đích UPDATE balance → dò được lệch', async () => {
    // Tạo một tài khoản platform/revenue
    const revenue = await ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.REVENUE,
    );

    // Phá balance: cộng thêm 1000 vào cột balance, KHÔNG ghi ledger_entries
    await dataSource.query(
      `UPDATE ledger_accounts SET balance = balance + 1000 WHERE id = ?`,
      [revenue.id],
    );

    const kq = await doiSoat.doiSoat();
    expect(kq.can_bang).toBe(false);
    expect(kq.so_tai_khoan_lech).toBe(1);

    const lech = kq.tai_khoan_lech[0];
    expect(lech.id).toBe(revenue.id);
    expect(lech.lech).toBe('1000');
    expect(lech.balance).toBe('1000');
    expect(lech.tong_but_toan).toBe('0');
  });

  it('nạp tiền vào platform/escrow_hold → tong_dang_giu_ho đúng, dạng chuỗi', async () => {
    const gateway = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    const escrow = await ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

    await ledger.post({
      idempotencyKey: `test-topup-escrow-${ID_BASE + 1}`,
      type: LedgerTxType.TOPUP,
      entries: [
        { accountId: Number(gateway.id), amount: -50_000n },
        { accountId: Number(escrow.id), amount: 50_000n },
      ],
    });

    const kq = await doiSoat.doiSoat();
    expect(kq.tong_dang_giu_ho).toBe('50000');
    expect(typeof kq.tong_dang_giu_ho).toBe('string');
  });
});
