import { DataSource, Repository } from 'typeorm';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { User } from '@identity/users/entities/user.entity';
import { Wallet } from './entities/wallet.entity';
import { WalletsService } from './wallets.service';

/**
 * Lịch sử ví phải chỉ ra được dòng nào thuộc đơn nào (D-19, E2E mobile 02/11).
 *
 * App đang đọc `GET /payments` nên tiền hoàn và tiền nạp không bao giờ hiện:
 * đơn trả bằng ví bị huỷ, sổ cái đã ghi `escrow_refund +510.500`, mà app chỉ
 * có "Thanh toán đơn hàng −510.500đ". Người dùng tưởng mất tiền.
 *
 * Đường đúng đã có sẵn: `GET /wallets/transactions` đọc thẳng sổ cái. Thứ còn
 * thiếu để app ghép dòng "Hoàn tiền" với đúng đơn là MÃ ĐƠN: bút toán giữ tiền
 * gắn `reference = order`, còn bút toán hoàn/nhả ký quỹ gắn `reference =
 * escrow` và chỉ cất mã đơn trong `metadata.orderId`. App không thể tự biết
 * escrow 17 là của đơn nào. Bài kiểm này đòi một trường `order_id` gom cả hai.
 *
 * Chạy database:  npm run test:db
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

type Dong = {
  type: string;
  amount: number;
  balance_after: number;
  order_id: number | null;
};

describe('WalletsService.getTransactions — có order_id cho hoàn tiền (D-19)', () => {
  let ds: DataSource;
  let ledger: LedgerService;
  let wallets: WalletsService;
  // Dải id ngẫu nhiên mỗi lần chạy: sổ cái không được dọn giữa các suite.
  const u = 8_000_000 + Math.floor(Math.random() * 1_000_000);
  const maDon = 700_000 + Math.floor(Math.random() * 100_000);

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
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    ledger = new LedgerService(ds);
    wallets = new WalletsService({} as Repository<Wallet>, ds, ledger);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('nạp, trả đơn bằng ví, hoàn ký quỹ đều hiện, hai dòng sau mang mã đơn', async () => {
    await wallets.topup(u, 600_000);

    const vi = await ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      u,
      LedgerPurpose.AVAILABLE,
    );
    const giu = await ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

    // Đúng hình dạng hai bút toán thật: giữ tiền gắn `order`
    // (payos.service.ts), hoàn ký quỹ gắn `escrow` + metadata.orderId
    // (escrows.service.ts).
    await ledger.post({
      idempotencyKey: `test_hold:${u}`,
      type: LedgerTxType.ORDER_HOLD,
      reference: { type: 'order', id: maDon },
      entries: [
        { accountId: Number(vi.id), amount: -510_500n },
        { accountId: Number(giu.id), amount: 510_500n },
      ],
    });
    await ledger.post({
      idempotencyKey: `test_refund:${u}`,
      type: LedgerTxType.ESCROW_REFUND,
      reference: { type: 'escrow', id: 17 },
      metadata: { orderId: maDon },
      entries: [
        { accountId: Number(giu.id), amount: -510_500n },
        { accountId: Number(vi.id), amount: 510_500n },
      ],
    });

    const r = (await wallets.getTransactions(u, 1, 20)) as {
      result: Dong[];
    };
    const gon = r.result.map((d) => ({
      type: d.type,
      amount: d.amount,
      balance_after: d.balance_after,
      order_id: d.order_id,
    }));

    expect(gon).toEqual([
      {
        type: 'escrow_refund',
        amount: 510_500,
        balance_after: 600_000,
        order_id: maDon,
      },
      {
        type: 'order_hold',
        amount: -510_500,
        balance_after: 89_500,
        order_id: maDon,
      },
      {
        type: 'topup',
        amount: 600_000,
        balance_after: 600_000,
        order_id: null,
      },
    ]);
  });
});
