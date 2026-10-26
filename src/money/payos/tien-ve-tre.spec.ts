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
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import {
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ: tiền PayOS về TRỄ, khi đơn không còn ở chỗ lúc phát link.
 *
 * `applyPaidPayment` quyết định tiền đi đâu dựa trên `payment.order`, một bản
 * đọc KHÔNG khoá từ đầu webhook. Từ lúc phát link tới lúc tiền về có thể là
 * mười lăm phút: người mua đã trả bằng ví, người mua đã huỷ, đơn đã đi giao.
 * Mỗi trường hợp ở đây là một lần tiền về mà đơn đã khác đi.
 *
 * Harness chép từ `payos.service.spec.ts`, kể cả cách gọi thẳng hàm private
 * `applyPaidPayment` (lý do ghi ở đầu file đó).
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

/** Một dòng SQL thô. Khai kiểu một lần ở đây để không rải `any` ra cả file. */
type Dong = { id: number; status: string; is_paid: number };

describe('PayosService: tiền về trễ', () => {
  let ds: DataSource;
  let payos: PayosService;
  let ledger: LedgerService;
  let escrows: EscrowsService;

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
    escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );

    const config = { get: () => 'test' } as never;
    const notifications = {
      create: () => Promise.resolve(undefined),
    } as never;

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

    // Không kiểm chữ ký thật: webhook giả gửi thẳng `data` đã "xác thực".
    // Chữ ký có bài kiểm riêng; ở đây chỉ đo việc xử lý sau chữ ký.
    (payos as unknown as { payos: unknown }).payos = {
      webhooks: {
        verify: (body: { data: unknown }) => Promise.resolve(body.data),
      },
    };
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

    buyerId = await makeUser('buyer@t.local', 'buyer');
    sellerId = await makeUser('seller@t.local', 'seller');
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

  /** Đơn chưa trả tiền, một món của người bán, kèm payment PayOS đang chờ. */
  async function makeUnpaidOrder(status: OrderStatus, amount: number) {
    const code = `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, final_amount, status,
        payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, ?, ?, 'payos', 0, 'T', '0900000000', 'addr')`,
      [code, buyerId, amount, amount, status],
    );
    const [order] = await ds.query<Dong[]>(
      'SELECT id FROM orders WHERE order_code = ?',
      [code],
    );

    await ds.query(`INSERT INTO categories (name) VALUES ('c')`);
    const [cat] = await ds.query<Dong[]>(
      'SELECT id FROM categories ORDER BY id DESC LIMIT 1',
    );
    await ds.query(
      `INSERT INTO products (name, price, stock, seller_id, category_id)
       VALUES ('p', ?, 10, ?, ?)`,
      [amount, sellerId, cat.id],
    );
    const [prod] = await ds.query<Dong[]>(
      'SELECT id FROM products ORDER BY id DESC LIMIT 1',
    );
    await ds.query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
       VALUES (?, ?, 'p', 1, ?, ?)`,
      [order.id, prod.id, amount, amount],
    );

    await ds.query(
      `INSERT INTO payments (order_id, user_id, amount, payment_method, status, type,
         payos_order_code, payos_payment_link_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        buyerId,
        amount,
        PaymentMethod.PAYOS,
        PaymentStatus.PENDING,
        PaymentType.ORDER_PAYMENT,
        String(order.id),
        `link-${order.id}`,
      ],
    );
    const [payment] = await ds.query<Dong[]>(
      'SELECT id FROM payments ORDER BY id DESC LIMIT 1',
    );

    return { orderId: order.id, paymentId: payment.id };
  }

  /**
   * Gọi thẳng ngã ba quyết định, đúng như webhook: đọc payment (kèm đơn)
   * trong transaction, rồi `applyPaidPayment`. `giua` chạy ĐÚNG giữa hai
   * bước đó, trên một kết nối khác, và commit xong trước khi đi tiếp.
   */
  async function applyPaid(
    paymentId: number,
    giua?: () => Promise<unknown>,
  ): Promise<unknown> {
    return ds.transaction(async (em: EntityManager) => {
      const payment = await em.findOne(Payment, {
        where: { id: paymentId },
        relations: ['order', 'user'],
      });
      if (giua) await giua();
      return (
        payos as never as {
          applyPaidPayment: (
            em: EntityManager,
            p: Payment,
            o: { idempotencyKey: string; transactionCode: string },
          ) => Promise<unknown>;
        }
      ).applyPaidPayment(em, payment as Payment, {
        idempotencyKey: `payos:test:${paymentId}`,
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
  const donLuc = async (id: number) => {
    const [o] = await ds.query<Dong[]>(
      'SELECT status, is_paid FROM orders WHERE id = ?',
      [id],
    );
    return { status: o.status, is_paid: Number(o.is_paid) };
  };

  /**
   * C. Trả bằng ví xong, rồi quét luôn mã QR PayOS cũ.
   *
   * Đơn đã `is_paid`, ký quỹ đã tách. Webhook vẫn ghi thêm một ORDER_HOLD vào
   * két, còn `createOrderEscrows` thấy đã có ký quỹ nên không tách thêm: số
   * tiền thứ hai nằm trong két mà không khoản ký quỹ nào trỏ tới, không bao
   * giờ ra được.
   */
  it('C: đơn đã trả bằng ví thì tiền PayOS về sau đi vào ví người mua', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.PENDING,
      300_000,
    );
    // Đường trả bằng ví: đơn đã trả, két có 300.000, một khoản ký quỹ.
    await ds.query(
      `UPDATE orders SET is_paid = 1, status = 'confirmed' WHERE id = ?`,
      [orderId],
    );
    await escrows.createOrderEscrowsWithExternalFunding(orderId);

    await applyPaid(paymentId);

    expect(await holdBalance()).toBe(300_000n);
    expect(await walletOf(buyerId)).toBe(300_000n);
  });

  /**
   * C. Tiền về khi đơn đã đi giao: bản cũ đặt thẳng `confirmed`, kéo đơn
   * ngược từ `shipping` về một bước đã qua.
   */
  it('C: tiền về khi đơn đang giao thì đơn vẫn đang giao', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.SHIPPING,
      200_000,
    );

    await applyPaid(paymentId);

    expect(await donLuc(orderId)).toEqual({
      status: OrderStatus.SHIPPING,
      is_paid: 1,
    });
    expect(await holdBalance()).toBe(200_000n);
  });

  it('C: tiền về khi đơn đã giao xong thì vào ví, đơn giữ nguyên', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.DELIVERED,
      200_000,
    );

    await applyPaid(paymentId);

    expect((await donLuc(orderId)).status).toBe(OrderStatus.DELIVERED);
    expect(await holdBalance()).toBe(0n);
    expect(await walletOf(buyerId)).toBe(200_000n);
  });

  /**
   * C. Huỷ đơn commit ĐÚNG giữa lúc webhook đọc payment và lúc quyết định.
   *
   * Lưới `paidAfterCancel` nhìn `payment.order.status` của bản đọc đầu
   * webhook, vẫn là `pending`. Đơn đã huỷ (hàng đã về kho) bị đặt lại thành
   * `confirmed`, tiền vào két thay vì vào ví người mua.
   */
  it('C: huỷ chen giữa webhook thì đơn không sống lại, tiền vào ví', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.PENDING,
      150_000,
    );

    await applyPaid(paymentId, () =>
      ds.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [
        orderId,
      ]),
    );

    expect(await donLuc(orderId)).toEqual({
      status: OrderStatus.CANCELLED,
      is_paid: 0,
    });
    expect(await holdBalance()).toBe(0n);
    expect(await walletOf(buyerId)).toBe(150_000n);
  });

  /**
   * C. Webhook "không thành công" tới SAU webhook thành công (PayOS gửi lại,
   * hoặc tới sai thứ tự) hạ payment SUCCESS xuống FAILED. Tiền vẫn nằm trong
   * sổ, còn chứng từ thì nói là chưa trả.
   */
  it('C: webhook thất bại không hạ payment đã thành công', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.PENDING,
      100_000,
    );
    await applyPaid(paymentId);

    await payos.handleWebhook({
      success: false,
      data: {
        orderCode: orderId,
        paymentLinkId: `link-${orderId}`,
        code: '01',
      },
    });

    const [p] = await ds.query<Dong[]>(
      'SELECT status FROM payments WHERE id = ?',
      [paymentId],
    );
    expect(p.status).toBe(PaymentStatus.SUCCESS);
  });

  /**
   * Đếm số khoản ký quỹ của đơn ĐÚNG LÚC bút toán ORDER_HOLD đầu tiên được
   * ghi, đọc qua chính transaction đang ghi (thấy cả dòng chưa commit).
   *
   * Review 3: huỷ/giải ngân khoá ký quỹ RỒI mới ghi sổ, còn các đường trả
   * tiền ghi sổ (khoá két giữ hộ) RỒI mới chèn ký quỹ. Hai thứ tự ngược nhau
   * trên cùng hai tài nguyên là công thức của deadlock 1213. Thứ tự chung
   * phải là đơn, rồi ký quỹ, rồi sổ cái; nên lúc ghi sổ, ký quỹ phải có rồi.
   */
  function demKyQuyLucGhiSo(orderId: number): () => number | undefined {
    let dem: number | undefined;
    const goc = ledger.post.bind(ledger) as LedgerService['post'];
    jest.spyOn(ledger, 'post').mockImplementation(async (input, em) => {
      if (dem === undefined && input.type === LedgerTxType.ORDER_HOLD && em) {
        const r = await em.query<Array<{ n: number | string }>>(
          'SELECT COUNT(*) AS n FROM escrows WHERE order_id = ?',
          [orderId],
        );
        dem = Number(r[0].n);
      }
      return goc(input, em);
    });
    return () => dem;
  }

  it('review 3: tiền PayOS về thì chèn ký quỹ trước khi ghi sổ', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.PENDING,
      100_000,
    );
    const dem = demKyQuyLucGhiSo(orderId);

    await applyPaid(paymentId);
    jest.restoreAllMocks();

    expect(dem()).toBe(1);
  });

  /**
   * Review 8: PayOS gửi trùng cùng một webhook, cùng lúc. Lượt sau chờ khoá
   * dòng đơn, tới lượt thì thấy đơn đã trả, nhưng payment nó đọc là ảnh chụp
   * cũ (\`pending\`) nên đi tiếp, ghi bút toán với ĐÚNG khoá chống trùng của
   * lượt trước và nổ 1062: PayOS nhận lỗi thay vì "Already paid".
   */
  it('review 8: webhook trùng tới cùng lúc thì lượt sau trả "Already paid"', async () => {
    const { orderId, paymentId } = await makeUnpaidOrder(
      OrderStatus.PENDING,
      100_000,
    );
    const webhook = () =>
      payos.handleWebhook({
        success: true,
        data: {
          orderCode: orderId,
          paymentLinkId: `link-${orderId}`,
          code: '00',
          reference: 'REF-R8',
        },
      });

    const kq = await Promise.allSettled([1, 2, 3, 4, 5].map(() => webhook()));

    expect(kq.filter((r) => r.status === 'rejected')).toEqual([]);
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      `SELECT COUNT(*) AS n FROM ledger_transactions
       WHERE reference_type = 'order' AND reference_id = ?`,
      [String(orderId)],
    );
    expect(Number(n)).toBe(1);
    const [p] = await ds.query<Dong[]>(
      'SELECT status FROM payments WHERE id = ?',
      [paymentId],
    );
    expect(p.status).toBe(PaymentStatus.SUCCESS);
  });
});
