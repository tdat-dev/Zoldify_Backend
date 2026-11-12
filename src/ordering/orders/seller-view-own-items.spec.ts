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

/**
 * MÀN ĐƠN BÁN CHỈ HIỆN PHẦN CỦA CHÍNH NGƯỜI BÁN (test staging 12/11, MUA-03).
 *
 * `GET /orders?as=seller` (web /shop/orders, app Đơn bán) lọc đúng TẬP đơn,
 * nhưng nạp mọi món của đơn: đơn có hàng của hai người bán thì mỗi người thấy
 * cả món và tổng tiền của người kia (đo: QA Shop B thấy "Mũ lưỡi trai giá rẻ"
 * của Shop Zoldify và tổng 997.800 của cả đơn).
 *
 * Bất biến: ở chế độ người bán, `items` chỉ gồm món của người đó; có
 * `seller_total` là tiền hàng phần của họ; `multi_seller` cho biết đơn còn hàng
 * người khác (người bán không tự huỷ được đơn như vậy).
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

describe('Màn Đơn bán chỉ hiện phần của chính người bán', () => {
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
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-sv')`);
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

  async function placeTwoSellerOrder(): Promise<number> {
    const products = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM products ORDER BY id',
    );
    for (const p of products) {
      await ds.query(
        'INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)',
        [buyerId, p.id],
      );
    }
    const order = (await orders.create(
      {
        shipping_address: 'so 1',
        receiver_name: 'N',
        receiver_phone: '0900000000',
        payment_method: PaymentMethod.COD,
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
      },
      asUser(buyerId),
    )) as Order;
    return order.id;
  }

  type SellerRow = Order & { seller_total?: number; multi_seller?: boolean };

  it('người bán A chỉ thấy món của A và tiền hàng phần của A', async () => {
    const id = await placeTwoSellerOrder();
    const page = (await orders.findAll(
      '1',
      '10',
      '',
      asUser(sellerA, UserRole.SELLER),
      'seller',
    )) as { result: SellerRow[] };
    const row = page.result.find((o) => o.id === id)!;
    expect(row.items.map((i) => i.product_name)).toEqual(['mon-a']);
    expect(Number(row.seller_total)).toBe(100000);
    expect(row.multi_seller).toBe(true);
  });

  // Staging 12/11 sau deploy: MỌI đơn bán đều báo multi_seller, kể cả đơn chỉ
  // có một món của người bán, vì bản đầu xoá `product.seller` của món mình
  // trước khi tính cờ. Ca hai người bán ở trên không bắt được lỗi đó.
  it('đơn chỉ có hàng của A thì không báo nhiều người bán', async () => {
    const [p] = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM products WHERE slug = 'mon-a'",
    );
    await ds.query(
      'INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)',
      [buyerId, p.id],
    );
    const order = (await orders.create(
      {
        shipping_address: 'so 1',
        receiver_name: 'N',
        receiver_phone: '0900000000',
        payment_method: PaymentMethod.COD,
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
      },
      asUser(buyerId),
    )) as Order;
    const page = (await orders.findAll(
      '1',
      '10',
      '',
      asUser(sellerA, UserRole.SELLER),
      'seller',
    )) as { result: SellerRow[] };
    const row = page.result.find((o) => o.id === order.id)!;
    expect(row.multi_seller).toBe(false);
    expect(Number(row.seller_total)).toBe(100000);
  });

  it('người mua vẫn thấy đủ hai món', async () => {
    const id = await placeTwoSellerOrder();
    const page = (await orders.findAll('1', '10', '', asUser(buyerId))) as {
      result: SellerRow[];
    };
    const row = page.result.find((o) => o.id === id)!;
    expect(row.items).toHaveLength(2);
  });
});
