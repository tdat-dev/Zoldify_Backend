import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { createCache } from 'cache-manager';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * GET /categories đếm sản phẩm của MỌI danh mục ở MỖI request, không cache
 * (rà soát "1 triệu dòng" 28/10, mục 4).
 *
 * `findAll` LEFT JOIN `products` rồi `COUNT ... GROUP BY category.id`: với một
 * triệu sản phẩm là đọc cả triệu dòng index cho mỗi lần trang chủ và thanh
 * điều hướng nạp danh mục. Đây là route gọi nhiều nhất trang chủ.
 *
 * Bài này đo: hai lần gọi liên tiếp chỉ gửi MỘT câu đếm; sửa danh mục thì lần
 * sau đếm lại (không phục vụ tên cũ suốt TTL).
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

const laCauDemSanPham = (c: string) =>
  /COUNT\s*\(\s*`?product`?\.`?id`?\s*\)/i.test(c);

describe('Danh sách danh mục có cache', () => {
  let ds: DataSource;
  const sql = new GhiSql();
  let catId: number;
  let sellerId: number;
  const R = Math.floor(Math.random() * 1e6);

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  // Tham số thứ ba là cache; ép kiểu để bài biên dịch được cả trước khi
  // service nhận nó (đỏ vì hành vi, không vì TypeScript).
  const dung = () =>
    new (CategoriesService as unknown as new (
      ...a: unknown[]
    ) => CategoriesService)(
      ds.getRepository(Category),
      { viToEn: () => Promise.resolve(null) },
      createCache({ ttl: 60_000 }),
    );

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Category, Product, User],
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
      `INSERT INTO users (full_name, email, password, role) VALUES ('b', ?, 'x', ?)`,
      [`dmc-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    await ds.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
      `Cache dm ${R}`,
      `cache-dm-${R}`,
    ]);
    catId = await idVuaChen();
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('SP', ?, 1000, 1, ?, ?, ?)`,
      [`dmc-${R}`, ProductStatus.ACTIVE, catId, sellerId],
    );
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
    result: Array<{ id: number; name: string; product_count: number }>;
  };
  const cuaToi = (k: Ket) => k.result.find((c) => c.id === catId);

  it('hai lần gọi liên tiếp chỉ đếm một lần, kết quả như nhau', async () => {
    const svc = dung();
    sql.cau = [];
    const a = (await svc.findAll('1', '100', '')) as Ket;
    const b = (await svc.findAll('1', '100', '')) as Ket;
    expect(sql.cau.filter(laCauDemSanPham)).toHaveLength(1);
    expect(b).toEqual(a);
    expect(cuaToi(a)?.product_count).toBe(1);
  });

  it('sửa danh mục thì lần sau thấy ngay', async () => {
    const svc = dung();
    await svc.findAll('1', '100', '');
    await svc.update(catId, { name: `Cache dm ${R} moi` });
    const sau = (await svc.findAll('1', '100', '')) as Ket;
    expect(cuaToi(sau)?.name).toBe(`Cache dm ${R} moi`);
  });
});
