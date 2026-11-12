import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
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

import { CreateOrderDto } from './dto/create-order.dto';

/**
 * GIÁ ĐỔI SAU KHI VÀO GIỎ (test staging 12/11, MUA-02).
 *
 * Giỏ không lưu giá lúc thêm, nên đơn luôn tính theo giá hiện tại của món. Bộ
 * chặn "Giá ... vừa thay đổi" trong transaction chỉ bắt giá đổi NGAY lúc tạo
 * đơn. Đo: người mua thấy 800.000 ở trang thanh toán, người bán sửa lên
 * 810.000, POST /orders tạo đơn #24 giá 810.000 mà không báo gì (đơn trả ví
 * bị trừ nhiều hơn số đã thấy).
 *
 * Bất biến: client gửi `expected_subtotal` là tiền hàng nó đã hiện; lệch với
 * giá hiện tại thì từ chối (409), không tạo đơn, không trừ kho. Không gửi thì
 * giữ hành vi cũ, để app bản cũ đang cài vẫn đặt được.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

describe('Đơn từ chối khi giá đã đổi so với lúc người mua xem', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let buyerId: number;
  let sellerA: number;
  let sellerB: number;

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
    sellerA = await createUser('a@t.local', UserRole.SELLER);
    sellerB = await createUser('b@t.local', UserRole.SELLER);
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-pc')`);
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories LIMIT 1',
    );
    for (const [slug, price, seller] of [
      ['mon-a', 100000, sellerA],
      ['mon-b', 90000, sellerB],
    ] as const) {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
         VALUES (?, ?, ?, 5, ?, ?, ?)`,
        [slug, slug, price, ProductStatus.ACTIVE, c.id, seller],
      );
    }

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
      { voidOpenLinkForOrder: () => Promise.resolve(false) },
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

  const asUser = (id: number, role = UserRole.BUYER): IUser => ({
    id,
    full_name: 'u',
    email: `${id}@t.local`,
    role,
    avatar: '',
  });

  async function cartOneItem(): Promise<number> {
    const [p] = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM products WHERE slug = 'mon-a'",
    );
    await ds.query(
      'INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 2)',
      [buyerId, p.id],
    );
    return p.id;
  }

  const placeOrder = (extra: Partial<CreateOrderDto>) =>
    orders.create(
      {
        shipping_address: 'so 1',
        receiver_name: 'N',
        receiver_phone: '0900000000',
        payment_method: PaymentMethod.COD,
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
        ...extra,
      },
      asUser(buyerId),
    );

  const countOrders = async () =>
    Number(
      (await ds.query<Array<{ n: string }>>('SELECT COUNT(*) n FROM orders'))[0]
        .n,
    );

  it('giá tăng sau khi người mua xem: từ chối, không tạo đơn, không trừ kho', async () => {
    const productId = await cartOneItem();
    await ds.query('UPDATE products SET price = 110000 WHERE id = ?', [
      productId,
    ]);

    await expect(placeOrder({ expected_subtotal: 200000 })).rejects.toThrow(
      /vừa thay đổi/,
    );
    expect(await countOrders()).toBe(0);
    const [p] = await ds.query<Array<{ stock: number }>>(
      'SELECT stock FROM products WHERE id = ?',
      [productId],
    );
    expect(Number(p.stock)).toBe(5);
  });

  it('giá khớp với số người mua đã thấy: đặt được', async () => {
    await cartOneItem();
    const order = (await placeOrder({ expected_subtotal: 200000 })) as Order;
    expect(Number(order.total_amount)).toBe(200000);
  });

  it('không gửi expected_subtotal (app bản cũ): vẫn đặt được như trước', async () => {
    await cartOneItem();
    const order = (await placeOrder({})) as Order;
    expect(Number(order.total_amount)).toBe(200000);
  });
});
