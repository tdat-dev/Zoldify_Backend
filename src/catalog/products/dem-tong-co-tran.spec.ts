import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { createCache } from 'cache-manager';
import { ProductsService } from './products.service';
import { Product, ProductStatus } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { ShopService } from '@catalog/shop/shop.service';
import { Review } from '@catalog/interactions/entities/review.entity';
import { InteractionsService } from '@catalog/interactions/interactions.service';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * Mỗi request danh sách công khai chạy một câu COUNT KHÔNG TRẦN (rà soát
 * "1 triệu dòng" 28/10, mục 2).
 *
 * `findAndCount`/`getManyAndCount` đếm MỌI dòng khớp bộ lọc để điền
 * `meta.total`. Với 1 triệu sản phẩm đang bán, `GET /products` không lọc gì
 * là `COUNT(DISTINCT product.id)` trên cả triệu dòng index, ở MỖI trang khách
 * lật qua (cache danh sách khoá theo số trang, nên trang 2 lại đếm lại).
 *
 * Bài này đo câu gửi xuống MySQL:
 *  · câu đếm phải CÓ TRẦN (đếm trong một bảng con `LIMIT 10001`), vì trần độ
 *    sâu đã chặn ở 10.000 dòng thì đếm quá số đó chẳng để làm gì;
 *  · lật từ trang 1 sang trang 2 cùng bộ lọc thì không đếm lại.
 * `meta.total` vẫn có mặt và đúng khi ít hơn trần.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

class GhiSql implements TypeOrmLogger {
  cau: string[] = [];
  logQuery(q: string) {
    this.cau.push(q);
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

const laCauDem = (c: string) => /COUNT\s*\(/i.test(c);
/** Câu đếm có trần: COUNT bọc ngoài một bảng con có LIMIT 10001. */
const coTran = (c: string) =>
  /COUNT\s*\([^)]*\)[\s\S]*FROM\s*\([\s\S]*LIMIT\s+10001/i.test(c);

describe('meta.total không đếm cả bảng ở mỗi request', () => {
  let ds: DataSource;
  const sql = new GhiSql();
  let products: ProductsService;
  let shop: ShopService;
  let reviews: InteractionsService;
  let sellerId: number;
  let buyerId: number;
  let catId: number;
  let productId: number;
  const R = Math.floor(Math.random() * 1e6);
  const SO_SP = 5;

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

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
        Review,
      ],
      synchronize: true,
      logger: sql,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('ban', ?, 'x', ?)`,
      [`dem-ban-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('mua', ?, 'x', ?)`,
      [`dem-mua-${R}@t.local`, UserRole.BUYER],
    );
    buyerId = await idVuaChen();
    await ds.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
      `Dem tong ${R}`,
      `dem-tong-${R}`,
    ]);
    catId = await idVuaChen();
    for (let i = 0; i < SO_SP; i++) {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
         VALUES (?, ?, 1000, 5, ?, ?, ?)`,
        [
          `Demtong${R} ${i}`,
          `dem-tong-${R}-${i}`,
          ProductStatus.ACTIVE,
          catId,
          sellerId,
        ],
      );
    }
    // Một món nháp: không được tính vào total.
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES (?, ?, 1000, 5, ?, ?, ?)`,
      [
        `Demtong${R} nhap`,
        `dem-tong-${R}-nhap`,
        ProductStatus.DRAFT,
        catId,
        sellerId,
      ],
    );
    productId = await idVuaChen();
    await ds.query(
      `INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, 5, 'tot')`,
      [buyerId, productId],
    );

    products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      {} as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );
    shop = new ShopService(
      ds.getRepository(Shop),
      ds.getRepository(User),
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(OrderItem),
    );
    reviews = new InteractionsService(
      ds.getRepository(User),
      ds.getRepository(Product),
      ds.getRepository(Review),
      ds.getRepository(Order),
      products,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM reviews WHERE product_id = ?', [productId]);
      await ds.query('DELETE FROM products WHERE seller_id = ?', [sellerId]);
      await ds.query('DELETE FROM categories WHERE id = ?', [catId]);
      await ds.query('DELETE FROM users WHERE id IN (?, ?)', [
        sellerId,
        buyerId,
      ]);
      await ds.destroy();
    }
  });

  beforeEach(() => {
    sql.cau = [];
  });

  type Ket = {
    meta: { current: number; pageSize: number; pages: number; total: number };
    result: unknown[];
  };

  it('GET /products: đếm có trần, lật trang 2 không đếm lại', async () => {
    const t1 = (await products.findAll('1', '2', {
      category_id: String(catId),
    })) as Ket;
    const t2 = (await products.findAll('2', '2', {
      category_id: String(catId),
    })) as Ket;

    expect(t1.meta.total).toBe(SO_SP);
    expect(t1.meta.pages).toBe(3);
    expect(t2.meta.total).toBe(SO_SP);
    expect(t1.result).toHaveLength(2);
    expect(t2.result).toHaveLength(2);

    const dem = sql.cau.filter(laCauDem);
    expect(dem).toHaveLength(1);
    expect(dem.every(coTran)).toBe(true);
  });

  it('GET /products?q=: nhánh tìm kiếm cũng đếm có trần, một lần', async () => {
    const q = { q: `Demtong${R}`, category_id: String(catId) };
    const t1 = (await products.findAll('1', '2', q)) as Ket;
    await products.findAll('2', '2', q);

    expect(t1.meta.total).toBe(SO_SP);
    const dem = sql.cau.filter(laCauDem);
    expect(dem).toHaveLength(1);
    expect(dem.every(coTran)).toBe(true);
  });

  it('GET /shop/:id/products: đếm có trần', async () => {
    const kq = (await shop.getShopProducts(sellerId, 1, 2)) as Ket;
    expect(kq.meta.total).toBe(SO_SP);
    expect(kq.meta.pages).toBe(3);
    const dem = sql.cau.filter(laCauDem);
    expect(dem.length).toBeGreaterThan(0);
    expect(dem.every(coTran)).toBe(true);
  });

  // Cỡ trang 1 cho trang ĐẦY: trang chưa đầy thì TypeORM tự suy total từ số
  // dòng nhận về và không gửi câu đếm nào, bài sẽ xanh mà chẳng đo được gì.
  it('GET /reviews/product/:id và /reviews: đếm có trần', async () => {
    const a = (await reviews.findByProduct(productId, '1', '1')) as Ket;
    const b = (await reviews.findAll('1', '1', {
      id: buyerId,
      role: 'buyer',
    } as IUser)) as Ket;
    expect(a.meta.total).toBe(1);
    expect(b.meta.total).toBeGreaterThanOrEqual(1);
    const dem = sql.cau.filter(laCauDem);
    expect(dem.length).toBeGreaterThan(0);
    expect(dem.every(coTran)).toBe(true);
  });
});
