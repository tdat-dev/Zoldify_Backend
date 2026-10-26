import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { PayosService } from './payos.service';
import { PayosController } from './payos.controller';
import { MaintenanceGuard } from '@common/guards/maintenance.guard';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { Payment } from '@money/payments/entities/payment.entity';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
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
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 4: webhook PayOS phải tới được, và tiền chỉ
 * được ghi khi KHỚP.
 *
 *  (a) `/payos/webhook` đi qua ThrottlerGuard toàn cục và MaintenanceGuard. Bật
 *      bảo trì là PayOS nhận 503; nhiều giao dịch cùng giây từ vài IP của PayOS
 *      là chạm trần throttle (429). Cả hai đều làm mất tin "đã trả tiền". Nút
 *      "kiểm tra lại" của người mua (`/payos/refresh/:orderId`) cũng vậy.
 *  (b) Webhook đã ký nhưng `amount` khác `payment.amount` vẫn được ghi trọn số
 *      của payment: chuyển thiếu 100.000 mà đơn vẫn thành đã trả đủ.
 *  (c) Webhook thành công, chữ ký đúng, mà không tìm thấy payment: chỉ
 *      `logger.warn` rồi trả 200. Tiền thật đã vào tài khoản mà không ai biết.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

type Dong = { id: number; status: string; is_paid: number; note?: string };

describe('(a) webhook và nút kiểm tra lại không bị throttle hay bảo trì chặn', () => {
  const boQuaThrottle = (ten: 'webhook' | 'refresh') =>
    Reflect.getMetadata(
      THROTTLER_SKIP + 'default',
      PayosController.prototype[ten],
    ) as boolean | undefined;

  it('POST /payos/webhook có @SkipThrottle', () => {
    expect(boQuaThrottle('webhook')).toBe(true);
  });

  it('GET /payos/refresh/:orderId có @SkipThrottle', () => {
    expect(boQuaThrottle('refresh')).toBe(true);
  });

  const guardDangBaoTri = () =>
    new MaintenanceGuard(
      { getValue: () => Promise.resolve('true') } as never,
      {
        verifyAsync: () => Promise.reject(new Error('khong co token')),
      } as never,
      { get: () => 'secret' } as never,
    );
  const ngCanh = (method: string, path: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method, path, url: path, headers: {} }),
      }),
    }) as unknown as ExecutionContext;

  it('bảo trì vẫn mở POST /api/v1/payos/webhook', async () => {
    await expect(
      guardDangBaoTri().canActivate(ngCanh('POST', '/api/v1/payos/webhook')),
    ).resolves.toBe(true);
  });

  it('bảo trì vẫn mở GET /api/v1/payos/refresh/:orderId', async () => {
    await expect(
      guardDangBaoTri().canActivate(ngCanh('GET', '/api/v1/payos/refresh/12')),
    ).resolves.toBe(true);
  });

  it('đối chứng: bảo trì vẫn chặn đặt hàng', async () => {
    await expect(
      guardDangBaoTri().canActivate(ngCanh('POST', '/api/v1/orders')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('(b)(c) webhook lệch số tiền / mã lạ', () => {
  let ds: DataSource;
  let payos: PayosService;
  let buyerId: number;
  let sellerId: number;
  let adminId: number;
  let thongBao: Array<{ user_id: number; type: string; title: string }>;
  let linkPayos: { status: string; amount: number; amountPaid: number };

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
      {
        create: (dto: { user_id: number; type: string; title: string }) => {
          thongBao.push(dto);
          return Promise.resolve(undefined);
        },
      } as never,
      ds.getRepository(Payment),
      ds.getRepository(Order),
      ds.getRepository(Wallet),
      ds.getRepository(User),
      ds,
      ledger,
      escrows,
    );
    // Chữ ký có bài kiểm riêng (webhook-khoa-rong.spec.ts); ở đây webhook giả
    // gửi thẳng `data` coi như đã xác thực.
    (payos as unknown as { payos: unknown }).payos = {
      webhooks: {
        verify: (body: { data: unknown }) => Promise.resolve(body.data),
      },
      paymentRequests: {
        get: () => Promise.resolve({ id: 'link-x', ...linkPayos }),
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
    buyerId = await taoUser('buyer@t.local', 'buyer');
    sellerId = await taoUser('seller@t.local', 'seller');
    adminId = await taoUser('admin@t.local', 'admin');
    thongBao = [];
  });

  async function taoUser(email: string, role: string): Promise<number> {
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

  async function taoDonChoTra(amount: number) {
    const code = `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, final_amount, status,
        payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, ?, ?, 'payos', 0, 'T', '0900000000', 'addr')`,
      [code, buyerId, amount, amount, OrderStatus.PENDING],
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
    const orderCode = String(order.id * 1000 + 1);
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
        orderCode,
        `link-${order.id}`,
      ],
    );
    const [payment] = await ds.query<Dong[]>(
      'SELECT id FROM payments ORDER BY id DESC LIMIT 1',
    );
    return { orderId: order.id, paymentId: payment.id, orderCode };
  }

  const webhook = (orderCode: string, amount: number) =>
    payos.handleWebhook({
      code: '00',
      success: true,
      data: {
        orderCode: Number(orderCode),
        amount,
        code: '00',
        paymentLinkId: 'link-x',
        reference: 'REF1',
      },
    });

  const soButToan = async () => {
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM ledger_transactions',
    );
    return Number(n);
  };
  const paymentLuc = async (id: number) => {
    const [p] = await ds.query<Dong[]>(
      'SELECT status, note FROM payments WHERE id = ?',
      [id],
    );
    return p;
  };
  const donLuc = async (id: number) => {
    const [o] = await ds.query<Dong[]>(
      'SELECT status, is_paid FROM orders WHERE id = ?',
      [id],
    );
    return { status: o.status, is_paid: Number(o.is_paid) };
  };

  it('(b) webhook chuyển THIẾU tiền: không ghi sổ, đơn chưa trả, payment chờ đối soát, log error, báo admin', async () => {
    const { orderId, paymentId, orderCode } = await taoDonChoTra(300_000);
    const loi = jest.spyOn(
      (payos as unknown as { logger: { error: () => void } }).logger,
      'error',
    );

    const kq = await webhook(orderCode, 200_000);

    expect(kq).toMatchObject({ success: true, processed: false });
    expect(await soButToan()).toBe(0);
    expect(await donLuc(orderId)).toEqual({ status: 'pending', is_paid: 0 });
    const p = await paymentLuc(paymentId);
    expect(p.status).not.toBe(PaymentStatus.SUCCESS);
    expect(p.note).toMatch(/CAN_DOI_SOAT/);
    expect(loi).toHaveBeenCalled();
    expect(thongBao.map((t) => t.user_id)).toContain(adminId);
    loi.mockRestore();
  });

  it('(b) gửi lại đúng webhook lệch đó lần nữa cũng không ghi sổ', async () => {
    const { orderCode } = await taoDonChoTra(300_000);
    await webhook(orderCode, 200_000);
    await webhook(orderCode, 200_000);
    expect(await soButToan()).toBe(0);
  });

  it('(b) nút kiểm tra lại cũng không ghi sổ khi PayOS báo số khác', async () => {
    const { orderId } = await taoDonChoTra(300_000);
    linkPayos = { status: 'PAID', amount: 200_000, amountPaid: 200_000 };

    await payos.refreshOrderStatus(orderId, buyerId);

    expect(await soButToan()).toBe(0);
    expect((await donLuc(orderId)).is_paid).toBe(0);
  });

  it('đối chứng: đúng số tiền thì vẫn ghi sổ và đơn thành đã trả', async () => {
    const { orderId, orderCode } = await taoDonChoTra(300_000);
    const kq = await webhook(orderCode, 300_000);
    expect(kq).toMatchObject({ success: true, processed: true });
    expect(await donLuc(orderId)).toEqual({ status: 'confirmed', is_paid: 1 });
  });

  it('(c) webhook thành công cho mã lạ: log error và báo admin, vẫn trả 2xx', async () => {
    const loi = jest.spyOn(
      (payos as unknown as { logger: { error: () => void } }).logger,
      'error',
    );

    const kq = await webhook('987654321', 50_000);

    expect(kq).toMatchObject({ success: true, processed: false });
    expect(loi).toHaveBeenCalled();
    expect(thongBao.map((t) => t.user_id)).toContain(adminId);
    loi.mockRestore();
  });
});
