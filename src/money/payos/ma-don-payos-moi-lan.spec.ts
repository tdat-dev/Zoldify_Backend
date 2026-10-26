import { DataSource } from 'typeorm';
import { PayosService } from './payos.service';
import { Payment } from '@money/payments/entities/payment.entity';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { EscrowsService } from '@money/escrows/escrows.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User } from '@identity/users/entities/user.entity';
import {
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 5: mỗi lần tạo link phải có orderCode mới.
 *
 * PayOS bắt `orderCode` DUY NHẤT trên toàn tài khoản merchant, kể cả link đã
 * hết hạn hay đã huỷ. `createOrderPaymentLink` dùng `orderCode = order.id`,
 * nên link đầu hết hạn (15 phút) hoặc bị huỷ là người mua KHÔNG BAO GIỜ tạo
 * được link mới cho đơn đó: PayOS trả "đơn thanh toán đã tồn tại".
 *
 * Mã nạp ví `Number(Date.now().slice(-7) + userId)` cũng tự đụng chính nó:
 * 7 chữ số cuối của mili-giây lặp lại sau 10^7 ms (khoảng 2 giờ 47 phút), và
 * ghép chuỗi với userId thì có thể ra đúng một số đã dùng cho đơn hàng.
 *
 * PayOS giả ở đây giữ đúng luật đó: một orderCode chỉ được tạo một lần.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

type TaoLink = { orderCode: number; amount: number; expiredAt?: number };

describe('PayosService: orderCode mới cho mỗi lần tạo link', () => {
  let ds: DataSource;
  let payos: PayosService;
  let buyerId: number;
  let daDung: Set<number>;
  let daHuy: number[];

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
    await ds.initialize();

    const ledger = new LedgerService(ds);
    const escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );
    payos = new PayosService(
      { get: () => 'test' } as never,
      { create: () => Promise.resolve(undefined) } as never,
      ds.getRepository(Payment),
      ds.getRepository(Order),
      ds.getRepository(Wallet),
      ds.getRepository(User),
      ds,
      ledger,
      escrows,
    );
    (payos as unknown as { payos: unknown }).payos = {
      paymentRequests: {
        cancel: (orderCode: number) => {
          daHuy.push(Number(orderCode));
          return Promise.resolve({});
        },
        create: (req: TaoLink) => {
          if (daDung.has(req.orderCode)) {
            return Promise.reject(
              new Error(
                `Đơn thanh toán đã tồn tại (orderCode ${req.orderCode})`,
              ),
            );
          }
          daDung.add(req.orderCode);
          return Promise.resolve({
            orderCode: req.orderCode,
            paymentLinkId: `pl-${req.orderCode}`,
            checkoutUrl: `https://pay.test/${req.orderCode}`,
            qrCode: 'qr',
            amount: req.amount,
            expiredAt: req.expiredAt,
          });
        },
      },
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
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('b','b@t.local','x','buyer')`,
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE email = 'b@t.local'",
    );
    buyerId = u.id;
    daDung = new Set();
    daHuy = [];
  });

  afterEach(() => jest.restoreAllMocks());

  async function taoDon(id?: number): Promise<number> {
    const code = `M-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO orders (id, order_code, user_id, total_amount, final_amount, status,
         payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, 100000, 100000, ?, 'payos', 0, 'T', '0900000000', 'addr')`,
      [id ?? null, code, buyerId, OrderStatus.PENDING],
    );
    const [o] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM orders WHERE order_code = ?',
      [code],
    );
    return o.id;
  }

  const maTrongDb = async (orderId: number) =>
    (
      await ds.query<Array<{ c: string }>>(
        'SELECT payos_order_code AS c FROM payments WHERE order_id = ? ORDER BY id',
        [orderId],
      )
    ).map((r) => r.c);

  it('link đầu hết hạn thì vẫn tạo được link mới cho cùng đơn', async () => {
    const id = await taoDon();
    const a = await payos.createOrderPaymentLink(id, buyerId);
    const b = await payos.createOrderPaymentLink(id, buyerId);

    expect(a.orderCode).not.toBe(b.orderCode);
    expect(await maTrongDb(id)).toEqual([
      String(a.orderCode),
      String(b.orderCode),
    ]);
  });

  it('đơn từng có link cũ mang orderCode = order.id (trước bản vá) vẫn tạo được link mới', async () => {
    const id = await taoDon();
    // Link phát trước khi vá, đã hết hạn: PayOS đã giữ mã `order.id`.
    daDung.add(id);
    await ds.query(
      `INSERT INTO payments (order_id, user_id, amount, payment_method, status, type,
         payos_order_code, payos_payment_link_id)
       VALUES (?, ?, 100000, ?, ?, ?, ?, ?)`,
      [
        id,
        buyerId,
        PaymentMethod.PAYOS,
        PaymentStatus.FAILED,
        PaymentType.ORDER_PAYMENT,
        String(id),
        `pl-cu-${id}`,
      ],
    );

    await expect(
      payos.createOrderPaymentLink(id, buyerId),
    ).resolves.toBeDefined();
  });

  it('webhook của link MỚI ghi đúng đơn, khoá sổ cái vẫn là payos:<orderCode>:<paymentLinkId>', async () => {
    const id = await taoDon();
    await payos.createOrderPaymentLink(id, buyerId);
    const b = await payos.createOrderPaymentLink(id, buyerId);

    const kq = await payos.handleWebhook({
      success: true,
      data: {
        orderCode: b.orderCode,
        amount: 100_000,
        code: '00',
        paymentLinkId: b.paymentLinkId,
        reference: 'REF-M5',
      },
    });

    expect(kq).toMatchObject({ success: true, processed: true });
    const [o] = await ds.query<Array<{ is_paid: number }>>(
      'SELECT is_paid FROM orders WHERE id = ?',
      [id],
    );
    expect(Number(o.is_paid)).toBe(1);
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM ledger_transactions WHERE idempotency_key = ?',
      [`payos:${b.orderCode}:${b.paymentLinkId}`],
    );
    expect(Number(n)).toBe(1);
  });

  /**
   * Review 26/10 mục 6. Mỗi lần tạo link nay ra một orderCode mới, nên một
   * đơn có thể có NHIỀU link pending cùng sống. `voidOpenLinkForOrder` (gọi
   * khi huỷ đơn) chỉ `findOne` nên đóng đúng một link: link còn lại vẫn trả
   * tiền vào được cho một đơn đã huỷ.
   */
  it('huỷ đơn đóng MỌI link pending của đơn, không chỉ một', async () => {
    const id = await taoDon();
    const a = await payos.createOrderPaymentLink(id, buyerId);
    const b = await payos.createOrderPaymentLink(id, buyerId);

    await payos.voidOpenLinkForOrder(id);

    expect(daHuy.sort()).toEqual([a.orderCode, b.orderCode].sort());
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      `SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND status = 'pending'`,
      [id],
    );
    expect(Number(n)).toBe(0);
  });

  it('hai lần nạp ví cách nhau 10^7 ms không ra cùng một orderCode', async () => {
    const t0 = 1_790_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    const a = await payos.createWalletTopupLink(50_000, buyerId);
    now.mockReturnValue(t0 + 10_000_000);
    const b = await payos.createWalletTopupLink(50_000, buyerId);

    expect(a.orderCode).not.toBe(b.orderCode);
  });

  it('mã nạp ví không đụng mã của đơn hàng', async () => {
    // Dựng đúng va chạm của công thức cũ: nạp ví = Number(7 số cuối của
    // Date.now ghép với userId). Đồng hồ kết thúc bằng "0000000" thì số 0 đầu
    // bị Number() nuốt mất, nạp ví ra đúng bằng userId, tức đúng mã của đơn
    // nào có id bằng userId (mã đơn cũ = order.id).
    const idDon = buyerId;
    await taoDon(idDon);
    const don = await payos.createOrderPaymentLink(idDon, buyerId);
    jest.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);

    const nap = await payos.createWalletTopupLink(50_000, buyerId);

    expect(nap.orderCode).not.toBe(don.orderCode);
  });
});
