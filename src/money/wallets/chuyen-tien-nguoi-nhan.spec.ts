import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { WalletsService } from './wallets.service';
import { TransferDto } from './dto/transfer.dto';
import { Wallet } from './entities/wallet.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { LedgerOwnerType, LedgerPurpose } from '@money/ledger/ledger.types';
import { User } from '@identity/users/entities/user.entity';

/**
 * POST /wallets/transfer: người nhận và số tiền không được kiểm.
 *
 *   1. DTO chỉ `@IsNumber`: số lẻ (1000.7) đi qua và bị `Math.round` lặng lẽ
 *      làm tròn; không trần trên; `to_user_id` âm hay lẻ cũng qua; `note`
 *      không giới hạn độ dài mà nằm nguyên trong metadata sổ cái.
 *   2. Service không hỏi người nhận có tồn tại không: `getOrCreateWallet`
 *      tạo luôn tài khoản sổ cái cho một id không có thật, tiền chuyển vào đó
 *      là mất, không ai rút được. Người nhận đã bị khoá hay đã xoá tài khoản
 *      cũng nhận được tiền mà không dùng được.
 *
 * Chạy trên MySQL thật: thứ cần đo là sổ cái không có bút toán nào sau một
 * lần chuyển bị từ chối.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('TransferDto: số tiền và người nhận hợp lệ', () => {
  const loi = async (o: Record<string, unknown>) =>
    (
      await validate(
        plainToInstance(TransferDto, { to_user_id: 5, amount: 10_000, ...o }),
      )
    ).map((e) => e.property);

  it('chuyển hợp lệ không lỗi', async () => {
    expect(await loi({})).toEqual([]);
    expect(await loi({ note: 'tiền cơm' })).toEqual([]);
  });

  it('số tiền lẻ, quá trần bị từ chối', async () => {
    expect(await loi({ amount: 1000.7 })).toContain('amount');
    expect(await loi({ amount: 2_000_000_000 })).toContain('amount');
  });

  it('to_user_id phải là số nguyên dương', async () => {
    expect(await loi({ to_user_id: 0 })).toContain('to_user_id');
    expect(await loi({ to_user_id: -3 })).toContain('to_user_id');
    expect(await loi({ to_user_id: 2.5 })).toContain('to_user_id');
  });

  it('ghi chú tối đa 255 ký tự', async () => {
    expect(await loi({ note: 'x'.repeat(256) })).toContain('note');
    expect(await loi({ note: 'x'.repeat(255) })).not.toContain('note');
  });
});

describe('WalletsService.transfer: người nhận phải là tài khoản đang hoạt động', () => {
  let ds: DataSource;
  let wallets: WalletsService;
  let ledger: LedgerService;
  const R = Math.floor(Math.random() * 1e6);
  const ids: number[] = [];

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [LedgerAccount, LedgerTransaction, LedgerEntry, User],
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
    wallets = new WalletsService({} as Repository<Wallet>, ds, ledger);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      if (ids.length) {
        await ds.query('DELETE FROM users WHERE id IN (?)', [ids]);
      }
      await ds.destroy();
    }
  });

  async function taoUser(
    tuyChon: { khoa?: boolean; xoa?: boolean } = {},
  ): Promise<number> {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role, is_locked, deleted_at)
       VALUES ('u', ?, 'x', 'buyer', ?, ?)`,
      [
        `ck-${R}-${ids.length}@t.local`,
        tuyChon.khoa ? 1 : 0,
        tuyChon.xoa ? new Date() : null,
      ],
    );
    const [r] = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    ids.push(Number(r.id));
    return Number(r.id);
  }

  const khaDung = (u: number) =>
    ledger.getBalance(LedgerOwnerType.USER, u, LedgerPurpose.AVAILABLE);

  it('người nhận đang hoạt động → chuyển được', async () => {
    const a = await taoUser();
    const b = await taoUser();
    await wallets.topup(a, 50_000);

    await wallets.transfer(a, b, 20_000);

    expect(Number(await khaDung(b))).toBe(20_000);
  });

  it.each([
    ['không tồn tại', null],
    ['đã bị khoá', { khoa: true }],
    ['đã xoá tài khoản', { xoa: true }],
  ])('người nhận %s → 400, tiền không đi', async (_ten, tuyChon) => {
    const a = await taoUser();
    const b = tuyChon === null ? 900_000_000 + R : await taoUser(tuyChon);
    await wallets.topup(a, 50_000);

    await expect(wallets.transfer(a, b, 20_000)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(Number(await khaDung(a))).toBe(50_000);
    expect(Number(await khaDung(b))).toBe(0);
  });
});
