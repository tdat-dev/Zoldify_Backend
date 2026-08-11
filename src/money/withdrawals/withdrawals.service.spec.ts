import { DataSource } from 'typeorm';
import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { WithdrawalsService } from './withdrawals.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { User } from '@identity/users/entities/user.entity';

/**
 * Test tích hợp trên MySQL THẬT. Xem đầu ledger.service.spec.ts để biết vì sao
 * không mock.
 *
 *   npm run test:db
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('WithdrawalsService — rút tiền ba chặng qua sổ cái', () => {
  let ds: DataSource;
  let service: WithdrawalsService;
  let ledger: LedgerService;

  let sellerId: number;
  let adminId: number;

  const BANK = {
    bank_name: 'Vietcombank',
    bank_account: '0123456789',
    bank_holder: 'NGUYEN VAN BAN',
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [
        User,
        Withdrawal,
        LedgerAccount,
        LedgerTransaction,
        LedgerEntry,
      ],
      synchronize: true,
      logging: false,
    });

    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }

    ledger = new LedgerService(ds);
    service = new WithdrawalsService(
      ds.getRepository(Withdrawal),
      ds.getRepository(User),
      ds,
      ledger,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
      'ledger_entries',
      'ledger_transactions',
      'ledger_accounts',
      'withdrawals',
      'users',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    sellerId = await makeUser('seller@t.local', 'seller');
    adminId = await makeUser('admin@t.local', 'admin');
    await fundSeller(1_000_000n);
  });

  async function makeUser(email: string, role: string): Promise<number> {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
      [email, email, role],
    );
    const [row] = await ds.query('SELECT id FROM users WHERE email = ?', [
      email,
    ]);
    return row.id;
  }

  /** Bơm tiền vào ví người bán qua sổ cái, như một lần giải ngân escrow */
  async function fundSeller(amount: bigint) {
    const gateway = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    const wallet = await ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      sellerId,
      LedgerPurpose.AVAILABLE,
    );
    await ledger.post({
      idempotencyKey: `test:fund:${sellerId}`,
      type: LedgerTxType.TOPUP,
      entries: [
        { accountId: Number(gateway.id), amount: -amount },
        { accountId: Number(wallet.id), amount },
      ],
    });
  }

  const available = () =>
    ledger.getBalance(LedgerOwnerType.USER, sellerId, LedgerPurpose.AVAILABLE);
  const pending = () =>
    ledger.getBalance(
      LedgerOwnerType.USER,
      sellerId,
      LedgerPurpose.WITHDRAWAL_PENDING,
    );
  const bankExternal = () =>
    ledger.getBalance(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.BANK_EXTERNAL,
    );

  it('gửi yêu cầu giữ tiền NGAY, không đợi admin duyệt', async () => {
    await service.create(sellerId, { amount: 300_000, ...BANK });

    expect(await available()).toBe(700_000n);
    expect(await pending()).toBe(300_000n);
  });

  it('KHÔNG rút được quá số dư', async () => {
    await expect(
      service.create(sellerId, { amount: 1_500_000, ...BANK }),
    ).rejects.toThrow();

    expect(await available()).toBe(1_000_000n);
    expect(await pending()).toBe(0n);

    // Bản ghi lệnh rút cũng phải biến mất theo — nó được lưu TRƯỚC bút toán,
    // nếu transaction không bao cả hai thì sẽ còn lại một lệnh rút mồ côi.
    const rows = await ds.manager.count(Withdrawal);
    expect(rows).toBe(0);
  });

  it('hai yêu cầu SONG SONG, mỗi cái bằng toàn bộ số dư: chỉ một cái qua', async () => {
    // Đây là lý do phải giữ tiền lúc gửi yêu cầu chứ không đợi duyệt.
    const results = await Promise.allSettled([
      service.create(sellerId, { amount: 1_000_000, ...BANK }),
      service.create(sellerId, { amount: 1_000_000, ...BANK }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);

    expect(await available()).toBe(0n);
    expect(await pending()).toBe(1_000_000n);
  });

  it('duyệt KHÔNG đụng tiền — tiền đã bị giữ từ trước', async () => {
    const w = await service.create(sellerId, { amount: 400_000, ...BANK });
    const txBefore = await ds.manager.count(LedgerTransaction);

    await service.approve(w.id, adminId);

    expect(await ds.manager.count(LedgerTransaction)).toBe(txBefore);
    expect(await available()).toBe(600_000n);
    expect(await pending()).toBe(400_000n);
  });

  it('từ chối trả tiền lại đúng vào ví', async () => {
    const w = await service.create(sellerId, { amount: 250_000, ...BANK });
    await service.reject(w.id, adminId, 'Sai số tài khoản');

    expect(await available()).toBe(1_000_000n);
    expect(await pending()).toBe(0n);

    const row = await ds.manager.findOneBy(Withdrawal, { id: w.id });
    expect(row?.status).toBe(WithdrawalStatus.REJECTED);
    expect(row?.note).toBe('Sai số tài khoản');
  });

  it('hoàn tất đưa tiền RA KHỎI hệ thống', async () => {
    const w = await service.create(sellerId, { amount: 500_000, ...BANK });
    await service.approve(w.id, adminId);
    await service.complete(w.id, adminId);

    expect(await available()).toBe(500_000n);
    expect(await pending()).toBe(0n);
    expect(await bankExternal()).toBe(500_000n);

    const row = await ds.manager.findOneBy(Withdrawal, { id: w.id });
    expect(row?.status).toBe(WithdrawalStatus.COMPLETED);
  });

  it('không hoàn tất được lệnh chưa duyệt', async () => {
    const w = await service.create(sellerId, { amount: 200_000, ...BANK });

    await expect(service.complete(w.id, adminId)).rejects.toThrow();
    expect(await bankExternal()).toBe(0n);
  });

  it('không xử lý lại lệnh đã xử lý', async () => {
    const w = await service.create(sellerId, { amount: 200_000, ...BANK });
    await service.reject(w.id, adminId);

    await expect(service.reject(w.id, adminId)).rejects.toThrow();
    await expect(service.approve(w.id, adminId)).rejects.toThrow();

    // Trả lại đúng một lần, không phải hai
    expect(await available()).toBe(1_000_000n);
  });

  it('BẤT BIẾN — tổng sổ cái bằng 0 sau cả vòng đời', async () => {
    const a = await service.create(sellerId, { amount: 300_000, ...BANK });
    const b = await service.create(sellerId, { amount: 200_000, ...BANK });

    await service.approve(a.id, adminId);
    await service.complete(a.id, adminId);
    await service.reject(b.id, adminId, 'không hợp lệ');

    expect(await available()).toBe(700_000n);
    expect(await pending()).toBe(0n);
    expect(await bankExternal()).toBe(300_000n);

    const [{ total }] = await ds.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries',
    );
    expect(BigInt(total)).toBe(0n);
  });
});
