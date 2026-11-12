import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderShipment } from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * ĐỔI CÁCH TRẢ CHO ĐƠN CHƯA TRẢ (báo lỗi của chủ dự án 12/11).
 *
 * Đơn được tạo TRƯỚC khi trả tiền. Chọn PayOS rồi không trả được (không có
 * thẻ, link hỏng), hay chọn ví mà ví thiếu tiền, thì đơn nằm đó với đúng một
 * nút "Thanh toán ngay" theo cách cũ: muốn trả khi nhận hàng phải huỷ đơn và
 * đặt lại từ đầu, trong khi giỏ đã bị xoá.
 *
 * Bất biến: chỉ người mua đổi được, chỉ khi đơn còn `pending` và chưa trả.
 * Sau khi người bán xác nhận, cách trả quyết định vận đơn GHN (COD thu hộ hay
 * không), nên không được đổi nữa. Đổi khỏi PayOS thì đóng link đang mở, để
 * tiền không vào một đơn đã chuyển sang trả khi nhận hàng.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

describe('Đổi cách trả cho đơn chưa trả', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let buyerId: number;
  let otherId: number;
  let productId: number;
  const closedLinks: number[] = [];

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [
        User,
        Category,
        Product,
        Follow,
        Shop,
        Cart,
        Order,
        OrderItem,
        OrderShipment,
        Escrow,
        Setting,
        LedgerAccount,
        LedgerTransaction,
        LedgerEntry,
      ],
      synchronize: true,
      logging: false,
    });
    await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    closedLinks.length = 0;
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
      'ledger_entries',
      'ledger_transactions',
      'ledger_accounts',
      'escrows',
      'order_shipments',
      'order_items',
      'orders',
      'carts',
      'products',
      'follows',
      'shops',
      'categories',
      'users',
      'settings',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    buyerId = await createUser('buyer@t.local', UserRole.BUYER);
    otherId = await createUser('other@t.local', UserRole.BUYER);
    const sellerId = await createUser('seller@t.local', UserRole.SELLER);
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-pm')`);
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories LIMIT 1',
    );
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('Mon', 'mon-pm', 100000, 10, ?, ?, ?)`,
      [ProductStatus.ACTIVE, c.id, sellerId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM products WHERE slug = 'mon-pm'",
    );
    productId = p.id;

    const notifications = {
      create: () => Promise.resolve(undefined),
    } as unknown as NotificationsService;
    const stockEvents = {
      phat: () => Promise.resolve(),
    } as unknown as StockEventsService;
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
    orders = new (OrdersService as unknown as new (
      ...a: unknown[]
    ) => OrdersService)(
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds.getRepository(OrderShipment),
      ds.getRepository(Shop),
      ds.getRepository(Cart),
      ds.getRepository(Product),
      ds.getRepository(User),
      notifications,
      { calculateFee: () => Promise.resolve({ total: 30_000 }) },
      escrows,
      {
        voidOpenLinkForOrder: (id: number) => {
          closedLinks.push(id);
          return Promise.resolve(true);
        },
      },
      {},
      ds,
      stockEvents,
    );
  });

  async function createUser(email: string, role: UserRole): Promise<number> {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
      [email, email, role],
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    return u.id;
  }

  const asUser = (id: number): IUser => ({
    id,
    full_name: 'u',
    email: `${id}@t.local`,
    role: UserRole.BUYER,
    avatar: '',
  });

  async function placeOrder(method: PaymentMethod): Promise<number> {
    await ds.query(
      'INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)',
      [buyerId, productId],
    );
    const order = (await orders.create(
      {
        shipping_address: 'so 1',
        receiver_name: 'N',
        receiver_phone: '0900000000',
        payment_method: method,
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
      },
      asUser(buyerId),
    )) as Order;
    return order.id;
  }

  const methodOf = async (id: number) =>
    (
      await ds.query<Array<{ payment_method: string }>>(
        'SELECT payment_method FROM orders WHERE id = ?',
        [id],
      )
    )[0].payment_method;

  it('đơn PayOS chưa trả đổi sang COD: đóng link PayOS, đơn thành COD', async () => {
    const id = await placeOrder(PaymentMethod.PAYOS);
    await orders.changePaymentMethod(id, PaymentMethod.COD, asUser(buyerId));
    expect(await methodOf(id)).toBe(PaymentMethod.COD);
    expect(closedLinks).toEqual([id]);
  });

  it('đơn COD đổi sang ví thì giữ nguyên chờ xác nhận, chưa trả', async () => {
    const id = await placeOrder(PaymentMethod.COD);
    await orders.changePaymentMethod(id, PaymentMethod.WALLET, asUser(buyerId));
    expect(await methodOf(id)).toBe(PaymentMethod.WALLET);
    const [o] = await ds.query<Array<{ status: string; is_paid: number }>>(
      'SELECT status, is_paid FROM orders WHERE id = ?',
      [id],
    );
    expect(o.status).toBe(OrderStatus.PENDING);
    expect(Number(o.is_paid)).toBe(0);
  });

  it('đơn đã trả hoặc người bán đã xác nhận thì không đổi được', async () => {
    const paid = await placeOrder(PaymentMethod.PAYOS);
    await ds.query('UPDATE orders SET is_paid = 1 WHERE id = ?', [paid]);
    await expect(
      orders.changePaymentMethod(paid, PaymentMethod.COD, asUser(buyerId)),
    ).rejects.toThrow();
    expect(await methodOf(paid)).toBe(PaymentMethod.PAYOS);

    const confirmed = await placeOrder(PaymentMethod.COD);
    await ds.query('UPDATE orders SET status = ? WHERE id = ?', [
      OrderStatus.CONFIRMED,
      confirmed,
    ]);
    await expect(
      orders.changePaymentMethod(
        confirmed,
        PaymentMethod.PAYOS,
        asUser(buyerId),
      ),
    ).rejects.toThrow();
    expect(await methodOf(confirmed)).toBe(PaymentMethod.COD);
  });

  it('người khác không đổi được cách trả đơn của mình', async () => {
    const id = await placeOrder(PaymentMethod.PAYOS);
    await expect(
      orders.changePaymentMethod(id, PaymentMethod.COD, asUser(otherId)),
    ).rejects.toThrow();
    expect(await methodOf(id)).toBe(PaymentMethod.PAYOS);
  });

  it('chỉ nhận COD, ví, PayOS', async () => {
    const id = await placeOrder(PaymentMethod.COD);
    await expect(
      orders.changePaymentMethod(id, PaymentMethod.MOMO, asUser(buyerId)),
    ).rejects.toThrow();
    expect(await methodOf(id)).toBe(PaymentMethod.COD);
  });
});
