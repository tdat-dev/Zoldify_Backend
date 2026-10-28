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
 * `GET /products` ở cỡ 1 triệu dòng (đo 28/10 trên zoldify_1mall, 1.001.015
 * sản phẩm, MySQL 8.4, buffer pool 512M).
 *
 * `find({ relations, skip, take })` khiến TypeORM bọc câu trong
 * `SELECT DISTINCTROW distinctAlias.id FROM (SELECT ... LEFT JOIN categories
 * LEFT JOIN users ...) distinctAlias ORDER BY ... LIMIT`: MySQL dựng bảng tạm
 * của CẢ tập hàng đang bán (941k dòng kèm hai JOIN) rồi mới sắp. Đo được:
 * trang 1 mặc định 16.936 ms, sort=most_viewed 6.222 ms trung bình, trang 499
 * 5.836 ms; dưới tải 20 kết nối phần lớn chạm trần max_execution_time 5 s và
 * trả 500. Bỏ bảng con mà vẫn giữ JOIN thì MySQL vẫn quét cả bảng rồi Sort
 * (15.967 ms, kể cả USE INDEX); chỉ câu lấy id KHÔNG JOIN mới đọc ngược
 * `idx_status_created` như mong đợi.
 *
 * Bài này gác hai điều cho mọi nhánh của danh sách (mặc định, sắp xếp, danh
 * mục, tìm kiếm): không câu nào có bảng con `distinctAlias`, và câu chọn trang
 * đọc index theo thứ tự thay vì Sort cả tập.
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
  cau: Array<{ q: string; p: unknown[] }> = [];
  logQuery(q: string, p?: unknown[]) {
    this.cau.push({ q, p: p ?? [] });
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

describe('Danh sách sản phẩm: chọn trang bằng id trước, nạp quan hệ sau', () => {
  let ds: DataSource;
  const sql = new GhiSql();
  let sellerId: number;
  let catId: number;
  const R = Math.floor(Math.random() * 1e6);

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

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
      [`dshb-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    await ds.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
      `Hai buoc ${R}`,
      `hai-buoc-${R}`,
    ]);
    catId = await idVuaChen();
    // 3.600 món (vài phần trăm không bán) để planner chọn như ở cỡ thật.
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id,
                             sold_count, view_count)
       WITH RECURSIVE s (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 59)
       SELECT CONCAT('Áo khoác số ', n), CONCAT('dshb-${R}-', n), 1000 + (n * 7) % 900, 5,
              IF(n % 25 = 0, ?, ?), ?, ?, (n * 13) % 500, (n * 17) % 900
         FROM (SELECT a.n * 60 + b.n AS n FROM s a, s b) t`,
      [ProductStatus.SOLD, ProductStatus.ACTIVE, catId, sellerId],
    );
    await ds.query('ANALYZE TABLE products');
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM products WHERE seller_id = ?', [sellerId]);
      await ds.query('DELETE FROM categories WHERE id = ?', [catId]);
      await ds.query('DELETE FROM users WHERE id = ?', [sellerId]);
      await ds.destroy();
    }
  });

  type Ket = {
    meta: { total: number };
    result: Array<{
      id: number;
      category?: { id: number };
      seller?: { id: number; full_name: string; email?: string };
    }>;
  };

  const truongHop: Array<[string, Record<string, string>]> = [
    ['mặc định', {}],
    ['sort=most_viewed', { sort: 'most_viewed' }],
    ['sort=price_asc', { sort: 'price_asc' }],
    ['danh mục', { category_id: '' }],
    ['tìm từ dài', { q: 'khoác' }],
  ];

  it.each(truongHop)(
    '%s: không có bảng con distinctAlias, câu chọn trang không Sort',
    async (_ten, loc) => {
      const qs = { ...loc };
      if ('category_id' in qs) qs.category_id = String(catId);
      sql.cau = [];
      const kq = (await moi().findAll('3', '20', qs)) as Ket;

      expect(kq.result).toHaveLength(20);
      expect(sql.cau.filter((c) => /distinctAlias/.test(c.q))).toEqual([]);

      // Câu chọn trang: câu đầu tiên có LIMIT/OFFSET đọc bảng products.
      const trang = sql.cau.find(
        (c) => /\bFROM `products`/.test(c.q) && /\bLIMIT\b/i.test(c.q),
      );
      expect(trang).toBeDefined();
      if (!loc.q) {
        const plan = await ds.query<Array<Record<string, string>>>(
          `EXPLAIN FORMAT=TREE ${trang!.q}`,
          trang!.p,
        );
        const cay = Object.values(plan[0]).join('\n');
        // Mỗi trường hợp ở đây đều có index (status|danh mục, cột sắp) đọc
        // theo thứ tự được; Sort nghĩa là sắp cả tập khớp bộ lọc.
        expect(cay).not.toMatch(/\bSort\b/);
      }
    },
  );

  it('kết quả giữ nguyên khuôn: thứ tự, danh mục, người bán chỉ id/tên/ảnh', async () => {
    const kq = (await moi().findAll('1', '20', {
      sort: 'most_viewed',
    })) as Ket;
    const ids = kq.result.map((p) => p.id);
    const dung = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM products WHERE status = 'active' AND deleted_at IS NULL
        ORDER BY view_count DESC LIMIT 20`,
    );
    // view_count có trùng nhau: so TẬP view_count theo thứ tự thay vì id.
    const xem = await ds.query<Array<{ id: number; view_count: number }>>(
      `SELECT id, view_count FROM products WHERE id IN (${ids.join(',')})`,
    );
    const theoId = new Map(xem.map((r) => [Number(r.id), r.view_count]));
    const vc = ids.map((id) => theoId.get(id));
    expect(vc).toEqual([...vc].sort((a, b) => Number(b) - Number(a)));
    expect(ids).toHaveLength(dung.length);
    for (const p of kq.result) {
      expect(p.category?.id).toBe(catId);
      expect(p.seller?.id).toBe(sellerId);
      expect(p.seller?.full_name).toBe('ban');
      expect(p.seller?.email).toBeUndefined();
    }
  });
});
