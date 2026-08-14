import { DataSource, EntityManager } from 'typeorm';
import { PayosService } from './payos.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { Payment } from '@money/payments/entities/payment.entity';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { LedgerOwnerType, LedgerPurpose } from '@money/ledger/ledger.types';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { PayosWebhookLog } from './entities/payos-webhook-log.entity';
import {
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from '@common/enums/payment.enum';

/**
 * Test tích hợp trên MySQL THẬT — xem đầu ledger.service.spec.ts để biết vì
 * sao không mock database.
 *
 * Chạy database:  npm run test:db
 *
 * Ở đây gọi thẳng `applyPaidPayment`, là hàm private. Cố ý: nó là ngã ba
 * quyết định "tiền của đơn này đi đâu", và cả hai đường vào công khai
 * (webhook và refreshOrderStatus) đều phải gọi mạng ra PayOS trước khi tới
 * được nó. Test một nhánh rẽ thì gọi đúng chỗ rẽ, đừng dựng cả cái đường.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('PayosService — tiền về sau khi đơn đã huỷ', () => {
  let ds: DataSource;
  let payos: PayosService;
  let ledger: LedgerService;

  let buyerId: number;
  let sellerId: number;

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
        Payment,
        Wallet,
        Setting,
        PayosWebhookLog,
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
    const escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );

    // Khoá PayOS là chuỗi giả: không nhánh nào trong test này gọi ra mạng.
    const config = { get: () => 'test' } as never;
    const notifications = {} as never;

    payos = new PayosService(
      config,
      notifications,
      ds.getRepository(Payment),
      ds.getRepository(Order),
      ds.getRepository(Wallet),
      ds.getRepository(User),
      ds,
      ledger,
      escrows,
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
      'payments',
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
    sellerId = await makeUser('seller@t.local', 'seller');
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

  /** Đơn chưa trả tiền, kèm một payment PayOS đang chờ. */
  async function makeUnpaidOrder(status: OrderStatus, amount: number) {
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, final_amount, status,
        payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, ?, ?, 'payos', 0, 'T', '0900000000', 'addr')`,
      [`T-${Date.now()}-${amount}`, buyerId, amount, amount, status],
    );
    const [order] = await ds.query(
      'SELECT id FROM orders ORDER BY id DESC LIMIT 1',
    );

    // Một dòng hàng để nếu có tạo ký quỹ thì nó chia được cho người bán
    await ds.query(`INSERT INTO categories (name) VALUES ('c')`);
    const [cat] = await ds.query(
      'SELECT id FROM categories ORDER BY id DESC LIMIT 1',
    );
    await ds.query(
      `INSERT INTO products (name, price, stock, seller_id, category_id)
       VALUES ('p', ?, 10, ?, ?)`,
      [amount, sellerId, cat.id],
    );
    const [prod] = await ds.query(
      'SELECT id FROM products ORDER BY id DESC LIMIT 1',
    );
    await ds.query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
       VALUES (?, ?, 'p', 1, ?, ?)`,
      [order.id, prod.id, amount, amount],
    );

    // INSERT thẳng như các fixture khác trong file. `repo.create({...})` ở đây
    // không chọn được overload vì cột thật tên `payment_method` chứ không phải
    // `method` — kiểu sai sẽ chỉ lộ ra ở `tsc`, còn ts-jest vẫn chạy qua.
    await ds.query(
      `INSERT INTO payments (order_id, user_id, amount, payment_method, status, type)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        buyerId,
        amount,
        PaymentMethod.PAYOS,
        PaymentStatus.PENDING,
        PaymentType.ORDER_PAYMENT,
      ],
    );
    const [payment] = await ds.query(
      'SELECT id FROM payments ORDER BY id DESC LIMIT 1',
    );

    return { orderId: order.id as number, paymentId: payment.id as number };
  }

  /** Gọi thẳng ngã ba quyết định, đúng như webhook sẽ gọi. */
  async function applyPaid(paymentId: number, key: string) {
    return ds.transaction(async (em: EntityManager) => {
      const payment = await em.findOne(Payment, {
        where: { id: paymentId },
        relations: ['order', 'user'],
      });
      return (
        payos as never as {
          applyPaidPayment: (
            em: EntityManager,
            p: Payment,
            o: { idempotencyKey: string; transactionCode: string },
          ) => Promise<unknown>;
        }
      ).applyPaidPayment(em, payment as Payment, {
        idempotencyKey: key,
        transactionCode: 'TX1',
      });
    });
  }

  const walletOf = (userId: number) =>
    ledger.getBalance(LedgerOwnerType.USER, userId, LedgerPurpose.AVAILABLE);
  const holdBalance = () =>
    ledger.getBalance(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

  it('đơn ĐÃ HUỶ mà tiền vẫn về thì tiền vào ví người mua, đơn KHÔNG sống lại', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.CANCELLED,
      500_000,
    );

    await applyPaid(paymentId, `payos:test:${paymentId}`);

    const [order] = await ds.query(
      'SELECT status, is_paid FROM orders WHERE id = ?',
      [orderId],
    );
    // Đây là lỗi cũ: bản trước đặt thẳng status = confirmed, đơn đã huỷ sống
    // lại trong khi hàng đã trả về kho.
    expect(order.status).toBe('cancelled');
    expect(Number(order.is_paid)).toBe(0);

    // Tiền không được biến mất: nó đã nằm ở ngân hàng thật rồi.
    expect(await walletOf(buyerId)).toBe(500_000n);
    expect(await holdBalance()).toBe(0n);

    const [{ n }] = await ds.query(
      'SELECT COUNT(*) AS n FROM escrows WHERE order_id = ?',
      [orderId],
    );
    expect(Number(n)).toBe(0);
  });

  it('đơn CHƯA huỷ thì vẫn đi đường ký quỹ như cũ', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.PENDING,
      300_000,
    );

    await applyPaid(paymentId, `payos:test:${paymentId}`);

    const [order] = await ds.query(
      'SELECT status, is_paid FROM orders WHERE id = ?',
      [orderId],
    );
    expect(order.status).toBe('confirmed');
    expect(Number(order.is_paid)).toBe(1);

    expect(await holdBalance()).toBe(300_000n);
    expect(await walletOf(buyerId)).toBe(0n);
  });

  it('gửi lại webhook của đơn đã huỷ không cộng tiền lần hai', async () => {
    const { paymentId } = await makeUnpaidOrder(OrderStatus.CANCELLED, 200_000);
    const key = `payos:test:${paymentId}`;

    await applyPaid(paymentId, key);
    await applyPaid(paymentId, key);

    expect(await walletOf(buyerId)).toBe(200_000n);
  });
});
