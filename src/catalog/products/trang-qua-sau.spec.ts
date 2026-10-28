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
 * Trang QUÁ SÂU của danh sách công khai bắt MySQL đọc rồi vứt bỏ cả trăm nghìn
 * dòng (rà soát "1 triệu dòng" 28/10, mục 1).
 *
 * `normalizePagination` chặn CỠ trang (≤ 100) nhưng không chặn SỐ trang:
 * `?current=9000&pageSize=100` thành `LIMIT 100 OFFSET 899900`. Với OFFSET,
 * MySQL vẫn phải đi qua 899.900 dòng trước khi trả 100 dòng; đo ở bảng đơn
 * hàng ~2,8 giây (xem `encodeCursor`). Route công khai, ai gõ URL cũng được,
 * một vòng lặp vài chục request là đủ chiếm hết pool kết nối.
 *
 * Bài này không đo thời gian (dữ liệu nhỏ thì câu nào cũng nhanh). Nó đo THỨ
 * GỬI XUỐNG DATABASE: không câu nào được mang OFFSET từ trần độ sâu trở lên,
 * và kết quả phải là danh sách rỗng giữ nguyên khuôn meta.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

/** Ghi lại mọi câu SQL đã gửi, để hỏi "có câu nào OFFSET sâu không". */
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

/** Vị trí bắt đầu lớn nhất xuất hiện trong các câu đã ghi (0 nếu không có). */
function offsetLonNhat(cau: string[]): number {
  let max = 0;
  for (const c of cau) {
    for (const m of c.matchAll(/OFFSET\s+(\d+)/gi)) {
      max = Math.max(max, Number(m[1]));
    }
    // Cú pháp `LIMIT a, b` của MySQL: a là vị trí bắt đầu.
    for (const m of c.matchAll(/LIMIT\s+(\d+)\s*,/gi)) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

const TRAN = 10_000;

describe('Trang quá sâu của danh sách công khai', () => {
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
      [`sau-ban-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('mua', ?, 'x', ?)`,
      [`sau-mua-${R}@t.local`, UserRole.BUYER],
    );
    buyerId = await idVuaChen();
    await ds.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
      `Sau ${R}`,
      `sau-${R}`,
    ]);
    catId = await idVuaChen();
    for (let i = 0; i < 3; i++) {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
         VALUES (?, ?, 1000, 5, ?, ?, ?)`,
        [
          `Sausp ${R} ${i}`,
          `sau-${R}-${i}`,
          ProductStatus.ACTIVE,
          catId,
          sellerId,
        ],
      );
    }
    productId = await idVuaChen();
    await ds.query(
      `INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, 5, 'tot')`,
      [buyerId, productId],
    );

    const productsSvc = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      {} as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );
    products = productsSvc;
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
      productsSvc,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(
        'DELETE FROM reviews WHERE product_id IN (SELECT id FROM products WHERE seller_id = ?)',
        [sellerId],
      );
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

  function kiemRong(kq: Ket, trang: number, co: number) {
    expect(kq.result).toEqual([]);
    expect(kq.meta.current).toBe(trang);
    expect(kq.meta.pageSize).toBe(co);
    expect(typeof kq.meta.total).toBe('number');
    expect(typeof kq.meta.pages).toBe('number');
    expect(offsetLonNhat(sql.cau)).toBeLessThan(TRAN);
  }

  it('GET /products?current=9000: rỗng, không câu nào OFFSET sâu', async () => {
    const kq = (await products.findAll('9000', '100', {})) as Ket;
    kiemRong(kq, 9000, 100);
  });

  it('GET /products?q=...&current=9000: nhánh tìm kiếm cũng vậy', async () => {
    const kq = (await products.findAll('9000', '10', {
      q: `Sausp ${R}`,
    })) as Ket;
    kiemRong(kq, 9000, 10);
  });

  it('GET /shop/:id/products?page=9000', async () => {
    const kq = (await shop.getShopProducts(sellerId, 9000, 20)) as Ket;
    kiemRong(kq, 9000, 20);
  });

  it('GET /reviews/product/:id?current=9000', async () => {
    const kq = (await reviews.findByProduct(productId, '9000', '10')) as Ket;
    kiemRong(kq, 9000, 10);
  });

  it('GET /reviews?current=9000', async () => {
    const kq = (await reviews.findAll('9000', '10', {
      id: buyerId,
      role: 'buyer',
    } as IUser)) as Ket;
    kiemRong(kq, 9000, 10);
  });

  it('trang nông vẫn trả dữ liệu như cũ', async () => {
    const kq = (await shop.getShopProducts(sellerId, 1, 20)) as Ket;
    expect(kq.result).toHaveLength(3);
    expect(kq.meta.total).toBe(3);
    expect(kq.meta.pages).toBe(1);
  });
});
