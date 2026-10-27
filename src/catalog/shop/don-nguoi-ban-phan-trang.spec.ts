import { DataSource } from 'typeorm';
import { ShopService } from './shop.service';
import { Shop } from './entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * GET /shop/:sellerId/orders phân trang theo DÒNG HÀNG, không theo đơn.
 *
 * `getSellerOrders` gọi `findAndCount` trên `order_items` rồi gom lại theo
 * đơn. Một đơn ba món nằm vắt qua hai trang (trang 1 thấy hai món, trang 2
 * thấy món thứ ba như một đơn khác), `limit=20` trả về ít hơn 20 đơn, và
 * `meta.total` đếm số món chứ không phải số đơn: app tính số trang sai.
 *
 * Chạy trên MySQL thật: thứ cần đo là câu phân trang, repo giả không có nó.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('Đơn của người bán phân trang theo đơn', () => {
  let ds: DataSource;
  let svc: ShopService;
  let sellerId: number;
  let buyerId: number;
  let catId: number;
  /** Id đơn theo thứ tự tạo (đơn sau có id lớn hơn). */
  let donIds: number[];

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
    svc = new ShopService(
      ds.getRepository(Shop),
      ds.getRepository(User),
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(OrderItem),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
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
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('ban', 'ban@t.local', 'x', ?)`,
      [UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('mua', 'mua@t.local', 'x', ?)`,
      [UserRole.BUYER],
    );
    buyerId = await idVuaChen();
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('C', 'c-pt')`);
    catId = await idVuaChen();

    const sp: number[] = [];
    for (let i = 0; i < 3; i++) {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
         VALUES (?, ?, 1000, 10, ?, ?, ?)`,
        [`SP ${i}`, `sp-pt-${i}`, ProductStatus.ACTIVE, catId, sellerId],
      );
      sp.push(await idVuaChen());
    }

    // Ba đơn, MỖI ĐƠN BA MÓN. Đơn giữa ở trạng thái khác để đo bộ lọc.
    donIds = [];
    for (let d = 0; d < 3; d++) {
      await ds.query(
        `INSERT INTO orders (order_code, user_id, final_amount, status,
                             receiver_name, receiver_phone, shipping_address)
         VALUES (?, ?, 3000, ?, 'N', '0900000000', 'So 1')`,
        [`ORD-PT-${d}`, buyerId, d === 1 ? 'confirmed' : 'pending'],
      );
      const oid = await idVuaChen();
      donIds.push(oid);
      for (const pid of sp) {
        await ds.query(
          `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
           VALUES (?, ?, 'SP', 1000, 1, 1000)`,
          [oid, pid],
        );
      }
    }
  });

  const chuShop = (): IUser => ({ id: sellerId, role: 'seller' }) as IUser;

  type Ket = {
    meta: { total: number; pages: number };
    result: Array<{ id: number; items: unknown[] }>;
  };

  it('một trang chứa trọn đơn, meta.total là số ĐƠN', async () => {
    const t1 = (await svc.getSellerOrders(
      sellerId,
      1,
      2,
      undefined,
      chuShop(),
    )) as Ket;

    expect(t1.meta.total).toBe(3);
    expect(t1.meta.pages).toBe(2);
    expect(t1.result).toHaveLength(2);
    for (const don of t1.result) expect(don.items).toHaveLength(3);
    // Mới nhất trước.
    expect(t1.result.map((d) => d.id)).toEqual([donIds[2], donIds[1]]);

    const t2 = (await svc.getSellerOrders(
      sellerId,
      2,
      2,
      undefined,
      chuShop(),
    )) as Ket;
    expect(t2.result.map((d) => d.id)).toEqual([donIds[0]]);
    expect(t2.result[0].items).toHaveLength(3);
  });

  it('lọc theo trạng thái thì total cũng đếm theo đơn', async () => {
    const kq = (await svc.getSellerOrders(
      sellerId,
      1,
      20,
      'confirmed',
      chuShop(),
    )) as Ket;

    expect(kq.meta.total).toBe(1);
    expect(kq.result).toHaveLength(1);
    expect(kq.result[0].id).toBe(donIds[1]);
    expect(kq.result[0].items).toHaveLength(3);
  });
});
