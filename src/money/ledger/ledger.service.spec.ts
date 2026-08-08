import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LedgerAccount } from './entities/ledger-account.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerTransaction } from './entities/ledger-transaction.entity';
import { LedgerService } from './ledger.service';
import { LedgerOwnerType, LedgerPurpose, LedgerTxType } from './ledger.types';

/**
 * Test tích hợp chạy trên MySQL THẬT.
 *
 * Không dùng sqlite hay mock: thứ cần kiểm ở đây là khoá dòng
 * SELECT ... FOR UPDATE và ràng buộc UNIQUE, hai thứ chỉ MySQL mới có.
 * Mock chúng đi thì test xanh mà chẳng chứng minh được gì.
 *
 * Chạy database cho test:
 *   docker run -d --name zoldify-test-mysql \
 *     -e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=zoldify_test \
 *     -p 3307:3306 mysql:8
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('LedgerService', () => {
  let dataSource: DataSource;
  let ledger: LedgerService;

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
      // Cố tình ném lỗi thay vì skip. Test tiền mà tự bỏ qua khi thiếu
      // database thì suite xanh trong khi chẳng kiểm gì — nguy hiểm hơn
      // là đỏ.
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}.\n` +
          `Chạy: docker run -d --name zoldify-test-mysql ` +
          `-e MYSQL_ROOT_PASSWORD=testpw -e MYSQL_DATABASE=zoldify_test ` +
          `-p 3307:3306 mysql:8\n` +
          `Lỗi gốc: ${(err as Error).message}`,
      );
    }

    ledger = new LedgerService(dataSource);
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

  /** Tạo cặp tài khoản quen dùng: ví người dùng và ô giữ hộ của sàn */
  async function makeAccounts(userId: number) {
    const wallet = await ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      userId,
      LedgerPurpose.AVAILABLE,
    );
    const hold = await ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );
    return { wallet: Number(wallet.id), hold: Number(hold.id) };
  }

  /** Nạp tiền vào ví để có cái mà tiêu */
  async function fund(walletId: number, amount: bigint, key: string) {
    const gateway = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    await ledger.post({
      idempotencyKey: key,
      type: LedgerTxType.TOPUP,
      entries: [
        { accountId: Number(gateway.id), amount: -amount },
        { accountId: walletId, amount },
      ],
    });
  }

  it('TEST 1 — tổng bút toán khác 0 thì ném lỗi và KHÔNG ghi gì', async () => {
    const { wallet, hold } = await makeAccounts(1);

    await expect(
      ledger.post({
        idempotencyKey: 'lech:1',
        type: LedgerTxType.ADJUSTMENT,
        entries: [
          { accountId: wallet, amount: -100_000n },
          { accountId: hold, amount: 90_000n }, // lệch 10.000
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const txCount = await dataSource.manager.count(LedgerTransaction);
    const entryCount = await dataSource.manager.count(LedgerEntry);
    expect(txCount).toBe(0);
    expect(entryCount).toBe(0);
  });

  it('TEST 2 — gọi trùng idempotencyKey chỉ tính MỘT lần', async () => {
    const { wallet } = await makeAccounts(2);

    await fund(wallet, 500_000n, 'topup:2');
    await fund(wallet, 500_000n, 'topup:2'); // đúng key cũ

    const txCount = await dataSource.manager.count(LedgerTransaction);
    expect(txCount).toBe(1);

    const balance = await ledger.getBalance(
      LedgerOwnerType.USER,
      2,
      LedgerPurpose.AVAILABLE,
    );
    expect(balance).toBe(500_000n);
  });

  it('TEST 3 — 100 lượt giải ngân ĐỒNG THỜI cùng escrow chỉ cộng tiền một lần', async () => {
    const { wallet, hold } = await makeAccounts(3);
    await fund(wallet, 1_000_000n, 'topup:3');

    // Đưa tiền vào ô giữ hộ trước
    await ledger.post({
      idempotencyKey: 'order_hold:3',
      type: LedgerTxType.ORDER_HOLD,
      entries: [
        { accountId: wallet, amount: -500_000n },
        { accountId: hold, amount: 500_000n },
      ],
    });

    const seller = await ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      99,
      LedgerPurpose.AVAILABLE,
    );

    // 100 request cùng lúc, cùng một khoá — đúng kịch bản người dùng bấm
    // nhiều lần hoặc webhook bị gửi lặp
    const attempts = Array.from({ length: 100 }, () =>
      ledger.post({
        idempotencyKey: 'escrow_release:3',
        type: LedgerTxType.ESCROW_RELEASE,
        entries: [
          { accountId: hold, amount: -500_000n },
          { accountId: Number(seller.id), amount: 500_000n },
        ],
      }),
    );

    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(100); // tất cả đều "thành công", nhưng...

    // ...chỉ có đúng MỘT giao dịch giải ngân được ghi
    const releases = await dataSource.manager.count(LedgerTransaction, {
      where: { type: LedgerTxType.ESCROW_RELEASE },
    });
    expect(releases).toBe(1);

    const sellerBalance = await ledger.getBalance(
      LedgerOwnerType.USER,
      99,
      LedgerPurpose.AVAILABLE,
    );
    expect(sellerBalance).toBe(500_000n);

    const holdBalance = await ledger.getBalance(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );
    expect(holdBalance).toBe(0n);
  });

  it('TEST 4 — trừ quá số dư thì ném lỗi, số dư không đổi', async () => {
    const { wallet, hold } = await makeAccounts(4);
    await fund(wallet, 100_000n, 'topup:4');

    await expect(
      ledger.post({
        idempotencyKey: 'order_hold:4',
        type: LedgerTxType.ORDER_HOLD,
        entries: [
          { accountId: wallet, amount: -300_000n },
          { accountId: hold, amount: 300_000n },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const balance = await ledger.getBalance(
      LedgerOwnerType.USER,
      4,
      LedgerPurpose.AVAILABLE,
    );
    expect(balance).toBe(100_000n);
  });

  it('TEST 5 — 50 lượt trừ tiền đồng thời KHÁC khoá: không mất bản ghi nào', async () => {
    // Đây là lỗi lost update mà code cũ mắc phải: đọc balance vào biến,
    // cộng trừ trong JS, rồi save. Hai request song song ghi đè nhau.
    const { wallet, hold } = await makeAccounts(5);
    await fund(wallet, 1_000_000n, 'topup:5');

    const debits = Array.from({ length: 50 }, (_, i) =>
      ledger.post({
        idempotencyKey: `order_hold:5:${i}`,
        type: LedgerTxType.ORDER_HOLD,
        entries: [
          { accountId: wallet, amount: -10_000n },
          { accountId: hold, amount: 10_000n },
        ],
      }),
    );

    await Promise.all(debits);

    const balance = await ledger.getBalance(
      LedgerOwnerType.USER,
      5,
      LedgerPurpose.AVAILABLE,
    );
    // 1.000.000 - 50 x 10.000 = 500.000, không xê dịch một đồng
    expect(balance).toBe(500_000n);

    const holdBalance = await ledger.getBalance(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );
    expect(holdBalance).toBe(500_000n);
  });

  it('BẤT BIẾN — tổng toàn bộ sổ cái luôn bằng 0', async () => {
    const { wallet, hold } = await makeAccounts(6);
    await fund(wallet, 800_000n, 'topup:6');
    await ledger.post({
      idempotencyKey: 'order_hold:6',
      type: LedgerTxType.ORDER_HOLD,
      entries: [
        { accountId: wallet, amount: -300_000n },
        { accountId: hold, amount: 300_000n },
      ],
    });

    const [{ total }] = (await dataSource.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries',
    )) as { total: string }[];

    expect(BigInt(total)).toBe(0n);
  });
});
