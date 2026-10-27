import { DataSource } from 'typeorm';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';
import type { TranslationService } from './translation.service';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * `product_count` của danh mục đếm cả sản phẩm đã xoá và sản phẩm nháp.
 *
 * `findAll` LEFT JOIN thẳng bảng `products` bằng tên bảng, nên không có điều
 * kiện xoá mềm nào được TypeORM tự thêm, và không lọc `status`. Trang chủ
 * hiện "Điện thoại (120)" trong khi bấm vào chỉ thấy 40 món: người mua tưởng
 * lọc hỏng.
 *
 * Chạy trên MySQL thật: thứ cần đo là câu JOIN.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('Đếm sản phẩm của danh mục', () => {
  let ds: DataSource;
  let svc: CategoriesService;
  let catId: number;
  let sellerId: number;
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
      entities: [Category, Product, User],
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
    svc = new CategoriesService(
      ds.getRepository(Category),
      {} as TranslationService,
    );

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('b', ?, 'x', ?)`,
      [`dm-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    await ds.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
      `Dem ${R}`,
      `dem-${R}`,
    ]);
    catId = await idVuaChen();

    const them = async (status: ProductStatus, xoa = false) => {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id, deleted_at)
         VALUES ('SP', ?, 1000, 1, ?, ?, ?, ?)`,
        [
          `dm-${R}-${Math.random()}`,
          status,
          catId,
          sellerId,
          xoa ? new Date() : null,
        ],
      );
    };
    await them(ProductStatus.ACTIVE);
    await them(ProductStatus.ACTIVE);
    await them(ProductStatus.DRAFT);
    await them(ProductStatus.PENDING);
    await them(ProductStatus.ACTIVE, true);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM products WHERE category_id = ?', [catId]);
      await ds.query('DELETE FROM categories WHERE id = ?', [catId]);
      await ds.query('DELETE FROM users WHERE id = ?', [sellerId]);
      await ds.destroy();
    }
  });

  it('chỉ đếm sản phẩm đang bán và chưa xoá', async () => {
    // Danh mục vừa tạo có id lớn nhất nên nằm đầu trang (ORDER BY id DESC).
    const kq = await svc.findAll('1', '100', '');
    const dm = kq.result.find((c) => Number(c.id) === catId);
    expect(dm).toBeDefined();
    expect(dm?.product_count).toBe(2);
  });
});
