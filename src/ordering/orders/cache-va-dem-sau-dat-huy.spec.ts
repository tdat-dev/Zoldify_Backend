import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderShipment } from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { ProductsService } from '@catalog/products/products.service';
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
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 8: cache và bộ đếm phải theo kịp kho.
 *
 *  · Cache chi tiết `product:{id}` (60s) và đời danh sách chỉ được làm mới ở
 *    các hàm của ProductsService. Kho đổi qua `orders.create`, huỷ đơn hay
 *    hoàn tiền thì trang sản phẩm vẫn hiện số cũ tới hết TTL: còn 0 mà hiện
 *    "còn 1", người mua bấm mua rồi nhận lỗi hết hàng.
 *  · `findOne` đếm lượt xem SAU `if (cached) return cached`, nên mỗi chu kỳ
 *    cache chỉ đếm được một lượt (comment ngay trên dòng INCR nói điều ngược
 *    lại, nhưng mã thì không làm vậy).
 *  · `sold_count` được cộng lúc đặt hàng nhưng không bao giờ bị trừ khi huỷ
 *    hay hoàn tiền: hàng bị huỷ hàng loạt vẫn đứng đầu "bán chạy".
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

describe('Cache sản phẩm và bộ đếm sau đặt/huỷ/hoàn', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let products: ProductsService;
  let buyerId: number;
  let sellerId: number;
  let productId: number;
  const KHO = 50;

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

    buyerId = await taoUser('buyer@t.local', UserRole.BUYER);
    sellerId = await taoUser('seller@t.local', UserRole.SELLER);
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-cd')`);
    const [c] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('Mon', 'mon-cd', 100000, ?, ?, ?, ?)`,
      [KHO, ProductStatus.ACTIVE, c.id, sellerId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM products WHERE slug = 'mon-cd'`,
    );
    productId = p.id;

    const notifications = {
      create: () => Promise.resolve(undefined),
    } as unknown as NotificationsService;
    const khoPhat = {
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
    products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      notifications,
      createCache({ ttl: 60_000 }),
      khoPhat,
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
      {
        calculateFee: () => Promise.resolve({ total: 30_000 }),
      },
      escrows,
      {
        voidOpenLinkForOrder: () => Promise.resolve(false),
      },
      {},
      ds,
      khoPhat,
      products,
    );
  });

  async function taoUser(email: string, role: UserRole): Promise<number> {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
      [email, email, role],
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM users WHERE email = ?`,
      [email],
    );
    return u.id;
  }

  const nguoiMua = (): IUser => ({
    id: buyerId,
    full_name: 'b',
    email: 'buyer@t.local',
    role: UserRole.BUYER,
    avatar: '',
  });

  async function datDon(qty: number): Promise<number> {
    await ds.query(
      `INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)`,
      [buyerId, productId, qty],
    );
    const don = (await orders.create(
      {
        shipping_address: 'so 1',
        receiver_name: 'N',
        receiver_phone: '0900000000',
        payment_method: PaymentMethod.COD,
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
      },
      nguoiMua(),
    )) as Order;
    return don.id;
  }

  const daBan = async () =>
    Number(
      (
        await ds.query<Array<{ sold_count: number }>>(
          'SELECT sold_count FROM products WHERE id = ?',
          [productId],
        )
      )[0].sold_count,
    );

  it('đặt hàng xong thì trang chi tiết thấy kho mới, không phải số trong cache', async () => {
    expect(Number((await products.findOne(productId)).stock)).toBe(KHO);
    await datDon(3);
    expect(Number((await products.findOne(productId)).stock)).toBe(KHO - 3);
  });

  it('đặt hàng xong thì danh sách cũng thấy kho mới', async () => {
    const truoc = (await products.findAll('1', '10', {})) as {
      result: Product[];
    };
    expect(Number(truoc.result[0].stock)).toBe(KHO);
    await datDon(2);
    const sau = (await products.findAll('1', '10', {})) as {
      result: Product[];
    };
    expect(Number(sau.result[0].stock)).toBe(KHO - 2);
  });

  it('huỷ đơn xong thì chi tiết thấy kho đã hoàn, sold_count trừ lại', async () => {
    const don = await datDon(4);
    expect(Number((await products.findOne(productId)).stock)).toBe(KHO - 4);
    expect(await daBan()).toBe(4);

    await orders.cancel(don, nguoiMua());

    expect(Number((await products.findOne(productId)).stock)).toBe(KHO);
    expect(await daBan()).toBe(0);
  });

  it('hoàn tiền đơn đã giao thì kho về, cache mới, sold_count trừ lại', async () => {
    const don = await datDon(2);
    await ds.query(`UPDATE orders SET status = ?, is_paid = 1 WHERE id = ?`, [
      OrderStatus.DELIVERED,
      don,
    ]);
    expect(Number((await products.findOne(productId)).stock)).toBe(KHO - 2);

    await orders.updateStatus(
      don,
      { status: OrderStatus.REFUNDED },
      {
        id: 999,
        full_name: 'admin',
        email: 'a@t.local',
        role: UserRole.ADMIN,
        avatar: '',
      },
    );

    expect(Number((await products.findOne(productId)).stock)).toBe(KHO);
    expect(await daBan()).toBe(0);
  });

  it('sold_count không xuống dưới 0', async () => {
    const don = await datDon(3);
    await ds.query('UPDATE products SET sold_count = 1 WHERE id = ?', [
      productId,
    ]);
    await orders.cancel(don, nguoiMua());
    expect(await daBan()).toBe(0);
  });

  it('mỗi lượt xem đều được đếm, kể cả khi trúng cache', async () => {
    const incr = jest.fn(() => Promise.resolve(1));
    (products as unknown as { redis: unknown }).redis = { incr };

    await products.findOne(productId);
    await products.findOne(productId);
    await products.findOne(productId);

    expect(incr).toHaveBeenCalledTimes(3);
  });
});
