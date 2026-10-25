import { HttpException } from '@nestjs/common';
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
 * BÀI KIỂM ĐỎ: hai admin cùng xử lý một yêu cầu rút tiền.
 *
 * `approve` không có transaction lẫn khoá; `reject` và `complete` có
 * transaction nhưng đọc yêu cầu bằng câu đọc thường. Hai admin mở cùng một
 * yêu cầu, một người duyệt một người từ chối: cả hai cùng thấy `pending`, cả
 * hai cùng "thành công", và yêu cầu kết thúc ở trạng thái của người ghi sau
 * trong khi tiền đã chạy theo người ghi trước.
 *
 * Harness chép từ `withdrawals.service.spec.ts`.
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

/** Một dòng SQL thô. Khai kiểu một lần ở đây để không rải `any` ra cả file. */
type Dong = { id: number; status: string; is_paid: number };

describe('WithdrawalsService: hai admin bấm cùng lúc', () => {
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
    const [row] = await ds.query<Dong[]>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
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

  const trangThai = async (id: number): Promise<string> => {
    const [w] = await ds.query<Dong[]>(
      'SELECT status FROM withdrawals WHERE id = ?',
      [id],
    );
    return w.status;
  };

  const viCon = () =>
    ledger.getBalance(LedgerOwnerType.USER, sellerId, LedgerPurpose.AVAILABLE);
  const dangGiu = () =>
    ledger.getBalance(
      LedgerOwnerType.USER,
      sellerId,
      LedgerPurpose.WITHDRAWAL_PENDING,
    );

  /** Lượt thua phải nhận lỗi 4xx có lời giải thích, không phải lỗi 500. */
  const la4xx = (r: PromiseSettledResult<unknown>): boolean =>
    r.status === 'rejected' &&
    r.reason instanceof HttpException &&
    r.reason.getStatus() >= 400 &&
    r.reason.getStatus() < 500;

  /**
   * Năm cặp duyệt/từ chối chạy cùng lúc. Một cặp đơn lẻ có thể vô tình chạy
   * tuần tự; năm cặp song song thì gần như chắc chắn có cặp đan vào nhau.
   */
  it('G: duyệt và từ chối cùng lúc thì đúng một bên thắng, tiền đi một lần', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const w = await service.create(sellerId, { amount: 100_000, ...BANK });
      ids.push(w.id);
    }

    const kq = await Promise.all(
      ids.map((id) =>
        Promise.allSettled([
          service.approve(id, adminId),
          service.reject(id, adminId, 'trùng'),
        ]),
      ),
    );

    let soDuyet = 0;
    for (const [i, [duyet, tuChoi]] of kq.entries()) {
      const thang = [duyet, tuChoi].filter((r) => r.status === 'fulfilled');
      expect(thang).toHaveLength(1);
      expect(la4xx(duyet.status === 'fulfilled' ? tuChoi : duyet)).toBe(true);

      const trangThaiDung =
        duyet.status === 'fulfilled'
          ? WithdrawalStatus.APPROVED
          : WithdrawalStatus.REJECTED;
      expect(await trangThai(ids[i])).toBe(trangThaiDung);
      if (duyet.status === 'fulfilled') soDuyet += 1;
    }

    // Tiền đi đúng theo bên thắng: yêu cầu bị từ chối thì tiền về ví, yêu cầu
    // được duyệt thì tiền vẫn đang giữ chờ chuyển khoản.
    expect(await dangGiu()).toBe(BigInt(soDuyet * 100_000));
    expect(await viCon()).toBe(1_000_000n - BigInt(soDuyet * 100_000));
  });

  it('G: hai lần "đã chuyển khoản" cùng lúc thì một lần bị từ chối 4xx', async () => {
    const w = await service.create(sellerId, { amount: 200_000, ...BANK });
    await service.approve(w.id, adminId);

    const [a, b] = await Promise.allSettled([
      service.complete(w.id, adminId),
      service.complete(w.id, adminId),
    ]);

    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(la4xx(a.status === 'fulfilled' ? b : a)).toBe(true);
    expect(await dangGiu()).toBe(0n);
    expect(await trangThai(w.id)).toBe(WithdrawalStatus.COMPLETED);
  });
});
