import { DataSource } from 'typeorm';
import { Escrow, EscrowStatus } from './entities/escrow.entity';
import { EscrowsService } from './escrows.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import { Setting } from '@ops/settings/entities/setting.entity';

/**
 * Test tích hợp trên MySQL THẬT — xem đầu ledger.service.spec.ts để biết vì
 * sao không mock.
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

describe('EscrowsService — giải ngân và hoàn tiền qua sổ cái', () => {
  let ds: DataSource;
  let escrows: EscrowsService;
  let ledger: LedgerService;

  let buyerId: number;
  let sellerAId: number;
  let sellerBId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [
        User,
        Category,
        Product,
        Order,
        OrderItem,
        Escrow,
        Setting,
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

    const fee = new PlatformFeeService(ds);
    ledger = new LedgerService(ds);
    escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      fee,
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
      'escrows',
      'order_items',
      'orders',
      'products',
      'categories',
      'users',
      'settings',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      "INSERT INTO settings (`key`, value) VALUES ('platform_fee_percent', '5')",
    );

    buyerId = await makeUser('buyer@t.local', 'buyer');
    sellerAId = await makeUser('sellerA@t.local', 'seller');
    sellerBId = await makeUser('sellerB@t.local', 'seller');
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

  /** Dựng một đơn đã trả tiền, tiền đang nằm trong ô giữ hộ */
  async function makePaidOrder(
    parts: { sellerId: number; amount: number }[],
  ): Promise<number> {
    const total = parts.reduce((s, p) => s + p.amount, 0);
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, final_amount, status,
        payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, ?, 'confirmed', 'payos', 1, 'T', '0900000000', 'addr')`,
      [`T-${Date.now()}-${Math.round(total)}`, buyerId, total, total],
    );
    const [order] = await ds.query(
      'SELECT id FROM orders ORDER BY id DESC LIMIT 1',
    );

    // Tiền vào ô giữ hộ, đúng như webhook PayOS làm
    const gateway = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    const hold = await ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );
    await ledger.post({
      idempotencyKey: `test:pay:${order.id}`,
      type: LedgerTxType.ORDER_HOLD,
      entries: [
        { accountId: Number(gateway.id), amount: -BigInt(total) },
        { accountId: Number(hold.id), amount: BigInt(total) },
      ],
    });

    for (const p of parts) {
      await ds.query(
        `INSERT INTO escrows (order_id, buyer_id, seller_id, amount, status)
         VALUES (?, ?, ?, ?, 'holding')`,
        [order.id, buyerId, p.sellerId, p.amount],
      );
    }
    return order.id;
  }

  const balanceOf = (userId: number) =>
    ledger.getBalance(LedgerOwnerType.USER, userId, LedgerPurpose.AVAILABLE);
  const holdBalance = () =>
    ledger.getBalance(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );
  const revenueBalance = () =>
    ledger.getBalance(LedgerOwnerType.PLATFORM, null, LedgerPurpose.REVENUE);

  it('giải ngân trừ đúng 5% phí sàn', async () => {
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 1_000_000 },
    ]);

    await escrows.release(orderId);

    expect(await balanceOf(sellerAId)).toBe(950_000n);
    expect(await revenueBalance()).toBe(50_000n);
    expect(await holdBalance()).toBe(0n);

    const [e] = await ds.manager.find(Escrow, {
      where: { order: { id: orderId } },
    });
    expect(e.status).toBe(EscrowStatus.RELEASED);
    expect(e.released_at).toBeTruthy();
  });

  it('gọi giải ngân hai lần chỉ chuyển tiền một lần', async () => {
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 500_000 },
    ]);

    await escrows.release(orderId);
    // Lần hai không còn escrow HOLDING nào nên ném lỗi — đó là hành vi đúng,
    // điều bắt buộc là số dư không nhúc nhích.
    await expect(escrows.release(orderId)).rejects.toThrow();

    expect(await balanceOf(sellerAId)).toBe(475_000n);
    expect(await revenueBalance()).toBe(25_000n);
  });

  it('đơn của hai người bán: cả hai cùng nhận, phí tính riêng từng khoản', async () => {
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 300_000 },
      { sellerId: sellerBId, amount: 700_000 },
    ]);

    await escrows.release(orderId);

    expect(await balanceOf(sellerAId)).toBe(285_000n);
    expect(await balanceOf(sellerBId)).toBe(665_000n);
    expect(await revenueBalance()).toBe(50_000n);
    expect(await holdBalance()).toBe(0n);
  });

  it('một khoản hỏng thì KHÔNG ai nhận được đồng nào', async () => {
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 300_000 },
      { sellerId: sellerBId, amount: 700_000 },
    ]);

    // Cho khoản thứ hai nổ giữa chừng
    const real = ledger.post.bind(ledger);
    let calls = 0;
    jest.spyOn(ledger, 'post').mockImplementation(async (input, em) => {
      calls += 1;
      if (calls === 2) throw new Error('mô phỏng lỗi ở khoản thứ hai');
      return real(input, em);
    });

    await expect(escrows.release(orderId)).rejects.toThrow('khoản thứ hai');
    jest.restoreAllMocks();

    // Người bán A cũng không được cộng, dù khoản của A đã chạy xong
    expect(await balanceOf(sellerAId)).toBe(0n);
    expect(await balanceOf(sellerBId)).toBe(0n);
    expect(await holdBalance()).toBe(1_000_000n);

    const rows = await ds.manager.find(Escrow, {
      where: { order: { id: orderId } },
    });
    expect(rows.every((e) => e.status === EscrowStatus.HOLDING)).toBe(true);
  });

  it('hoàn tiền trả đủ cho người mua, KHÔNG thu phí', async () => {
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 800_000 },
    ]);

    await escrows.refund(orderId);

    expect(await balanceOf(buyerId)).toBe(800_000n);
    expect(await revenueBalance()).toBe(0n);
    expect(await holdBalance()).toBe(0n);
    expect(await balanceOf(sellerAId)).toBe(0n);
  });

  it('thiếu cấu hình phí thì không thu, KHÔNG tự đoán một con số', async () => {
    await ds.query("DELETE FROM settings WHERE `key` = 'platform_fee_percent'");
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 400_000 },
    ]);

    await escrows.release(orderId);

    expect(await balanceOf(sellerAId)).toBe(400_000n);
    expect(await revenueBalance()).toBe(0n);
  });

  it('hoàn tiền chạy ĐƯỢC trong transaction của người gọi', async () => {
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 600_000 },
    ]);

    await ds.transaction(async (em) => {
      await escrows.refund(orderId, em);
      // Cùng transaction: đổi trạng thái đơn phải thấy được tiền vừa chuyển
      await em.query('UPDATE orders SET status = ? WHERE id = ?', [
        'cancelled',
        orderId,
      ]);
    });

    expect(await balanceOf(buyerId)).toBe(600_000n);
    expect(await holdBalance()).toBe(0n);
  });

  it('người gọi rollback thì tiền KHÔNG chuyển — huỷ đơn hỏng nửa chừng không được để tiền kẹt', async () => {
    // Đây là lỗi tìm ra ngày 14/08: orders.cancel() bọc lời gọi refund trong
    // try/catch rồi chỉ console.error, sau đó vẫn lưu đơn là đã huỷ. Hoàn
    // tiền hỏng thì tiền người mua kẹt trong escrow_hold vĩnh viễn.
    //
    // Nay refund nhận EntityManager nên nó cùng sống chết với việc đổi trạng
    // thái đơn. Test này giữ đúng tính chất đó: transaction hỏng thì KHÔNG
    // thứ gì trong đó có hiệu lực.
    const orderId = await makePaidOrder([
      { sellerId: sellerAId, amount: 700_000 },
    ]);

    await expect(
      ds.transaction(async (em) => {
        await escrows.refund(orderId, em);
        throw new Error('người gọi hỏng sau khi hoàn tiền');
      }),
    ).rejects.toThrow('người gọi hỏng sau khi hoàn tiền');

    expect(await balanceOf(buyerId)).toBe(0n);
    expect(await holdBalance()).toBe(700_000n);

    const rows = await ds.manager.find(Escrow, {
      where: { order: { id: orderId } },
    });
    expect(rows.every((e) => e.status === EscrowStatus.HOLDING)).toBe(true);
  });

  it('BẤT BIẾN — tổng sổ cái luôn bằng 0 sau mọi thao tác', async () => {
    const o1 = await makePaidOrder([{ sellerId: sellerAId, amount: 250_000 }]);
    const o2 = await makePaidOrder([
      { sellerId: sellerAId, amount: 120_000 },
      { sellerId: sellerBId, amount: 330_000 },
    ]);
    await escrows.release(o1);
    await escrows.refund(o2);

    const [{ total }] = await ds.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries',
    );
    expect(BigInt(total)).toBe(0n);
  });
});
