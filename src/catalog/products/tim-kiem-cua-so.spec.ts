import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { createCache } from 'cache-manager';
import { ProductsService } from './products.service';
import { Product, ProductStatus } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * Từ dài PHỔ BIẾN không được đi FULLTEXT cả bảng khi cửa sổ hàng mới nhất đã
 * đủ một trang (đợt đo 1 triệu dòng, 02/11): bài kiểm viết TRƯỚC.
 *
 * Đo trên 1.001.015 sản phẩm (zoldify_1mall, buffer pool 512M): "giày" khớp
 * 83.401 món, câu FULLTEXT chọn trang 2.049 ms khi ấm, hơn 5 s khi lạnh, vì
 * MySQL về bảng đọc TỪNG dòng khớp để lọc trạng thái rồi sắp theo created_at.
 * Dưới tải (`npm run loadtest` chế độ 1M, sau khi đã bắt buộc đủ từ) route
 * tìm kiếm vẫn p95 11.450 ms một người gọi và 500 ở 20 kết nối.
 *
 * Gác ba điều:
 *  · thứ tự mặc định + từ phổ biến: không câu nào có MATCH ... AGAINST;
 *  · từ hiếm (cửa sổ không đủ trang): vẫn ra kết quả, qua FULLTEXT;
 *  · sắp theo giá: vẫn FULLTEXT cả bảng ("rẻ nhất trong cửa sổ" là sai).
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

describe('Tìm từ dài: cửa sổ mới nhất trước, FULLTEXT khi cần', () => {
  let ds: DataSource;
  const sql = new GhiSql();
  let sellerId: number;
  const R = Math.floor(Math.random() * 1e6);
  const MA = `cs${R}`;
  const HIEM = `hiem${R}`;

  const moi = () =>
    new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      {} as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, Category, Product, Follow, Shop],
      synchronize: true,
      logger: sql,
    });
    await ds.initialize();
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('ban', ?, 'x', ?)`,
      [`tkcs-${R}@t.local`, UserRole.SELLER],
    );
    const [{ id }] = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    sellerId = Number(id);
    // 25 món "Áo khoác <MA>" mới nhất (đủ hơn một trang 20), và một món có
    // từ hiếm chỉ nằm trong MÔ TẢ (cửa sổ chỉ khớp tên).
    await ds.query(
      `INSERT INTO products (name, slug, description, price, stock, status, seller_id, created_at)
       WITH RECURSIVE s (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 24)
       SELECT CONCAT('Áo khoác ${MA} số ', n), CONCAT('tkcs-${R}-', n), 'mô tả',
              1000 + n, 5, ?, ?, NOW() - INTERVAL n SECOND FROM s`,
      [ProductStatus.ACTIVE, sellerId],
    );
    await ds.query(
      `INSERT INTO products (name, slug, description, price, stock, status, seller_id)
       VALUES ('Đèn bàn', ?, ?, 1000, 5, ?, ?)`,
      [
        `tkcs-${R}-hiem`,
        `Hàng ${HIEM} nhập khẩu`,
        ProductStatus.ACTIVE,
        sellerId,
      ],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM products WHERE seller_id = ?', [sellerId]);
      await ds.query('DELETE FROM users WHERE id = ?', [sellerId]);
      await ds.destroy();
    }
  });

  type Ket = { meta: { total: number }; result: Array<{ name: string }> };
  const coMatch = () => sql.cau.some((q) => /MATCH\s*\(/i.test(q));

  it('từ phổ biến, thứ tự mặc định: đủ trang trong cửa sổ, không FULLTEXT', async () => {
    sql.cau = [];
    const kq = (await moi().findAll('1', '20', {
      q: `khoác ${MA}`,
    })) as Ket;
    expect(kq.result).toHaveLength(20);
    expect(kq.result[0].name).toBe(`Áo khoác ${MA} số 0`);
    expect(kq.meta.total).toBe(25);
    expect(coMatch()).toBe(false);
  });

  it('từ hiếm chỉ có trong mô tả: cửa sổ không đủ trang, FULLTEXT vẫn tìm ra', async () => {
    sql.cau = [];
    const kq = (await moi().findAll('1', '20', { q: HIEM })) as Ket;
    expect(kq.result.map((p) => p.name)).toEqual(['Đèn bàn']);
    expect(coMatch()).toBe(true);
  });

  it('sắp theo giá: vẫn FULLTEXT cả bảng', async () => {
    sql.cau = [];
    const kq = (await moi().findAll('1', '20', {
      q: `khoác ${MA}`,
      sort: 'price_asc',
    })) as Ket;
    expect(kq.result[0].name).toBe(`Áo khoác ${MA} số 0`);
    expect(coMatch()).toBe(true);
  });
});
