import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { User } from '@identity/users/entities/user.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { StockEventsService } from '@catalog/stock/stock-events.service';

/**
 * GÕ TÊN DANH MỤC PHẢI RA HÀNG CỦA DANH MỤC ĐÓ (test staging 12/11, XEM-03).
 *
 * Đo: q="điện thoại" ra 10 món (Apple Watch, túi, sạc: mô tả có chữ "điện
 * thoại"), KHÔNG món nào trong danh mục Điện thoại (103 tin), vì tin trong đó
 * tên là "iPhone 12", "Samsung S21" và tìm kiếm chỉ khớp tên, mô tả.
 *
 * Bất biến: cả câu tìm trùng tên một danh mục (so theo slug, nên có dấu hay
 * không, hoa hay thường đều khớp) mà chưa lọc danh mục thì trả hàng của danh
 * mục đó. Câu khác ("ốp lưng") vẫn tìm chữ như cũ.
 *
 * Chạy database:  npm run test:db
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(90_000);

describe('Gõ tên danh mục ra hàng của danh mục đó', () => {
  let ds: DataSource;
  let svc: ProductsService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Product, Category, Shop, Follow, User],
      synchronize: true,
    });
    await ds.initialize();
    const ft = await ds.query<unknown[]>(
      "SHOW INDEX FROM products WHERE Key_name = 'ft_name_desc'",
    );
    if (ft.length === 0) {
      await ds.query(
        'ALTER TABLE products ADD FULLTEXT INDEX ft_name_desc (name, description)',
      );
    }

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['products', 'follows', 'shops', 'categories', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ('nguoi ban','s-cat@t.local','x','seller')`,
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users ORDER BY id DESC LIMIT 1',
    );
    const createCategory = async (name: string, slug: string) => {
      await ds.query(
        'INSERT INTO categories (name, slug, is_active) VALUES (?, ?, 1)',
        [name, slug],
      );
      const [c] = await ds.query<Array<{ id: number }>>(
        'SELECT id FROM categories WHERE slug = ?',
        [slug],
      );
      return c.id;
    };
    const phone = await createCategory('Điện thoại', 'dien-thoai');
    const accessory = await createCategory('Phụ kiện', 'phu-kien');

    const rows: Array<[string, string, number]> = [
      ['iPhone 12 Pro 128GB', 'Máy đẹp, pin 88%', phone],
      ['Samsung Galaxy S21', 'Còn bảo hành', phone],
      ['Ốp lưng iPhone 12', 'Hợp mọi điện thoại cùng cỡ', accessory],
    ];
    let i = 0;
    for (const [name, description, category] of rows) {
      await ds.query(
        `INSERT INTO products (name, slug, description, price, stock, seller_id, category_id, status)
         VALUES (?, ?, ?, ?, 5, ?, ?, 'active')`,
        [name, `cat-${i}`, description, (i + 1) * 1000, u.id, category],
      );
      i += 1;
    }

    svc = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      {
        create: () => Promise.resolve(undefined),
      } as unknown as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  const names = async (q: string): Promise<string[]> => {
    const r = (await svc.findAll('1', '20', { q })) as {
      result: Array<{ name: string }>;
    };
    return r.result.map((p) => p.name).sort();
  };

  it('"điện thoại" ra hàng trong danh mục Điện thoại', async () => {
    expect(await names('điện thoại')).toEqual([
      'Samsung Galaxy S21',
      'iPhone 12 Pro 128GB',
    ]);
  });

  it('gõ không dấu, in hoa cũng ra danh mục', async () => {
    expect(await names('Dien Thoai')).toEqual([
      'Samsung Galaxy S21',
      'iPhone 12 Pro 128GB',
    ]);
  });

  it('câu không trùng tên danh mục vẫn tìm theo chữ', async () => {
    expect(await names('ốp lưng')).toEqual(['Ốp lưng iPhone 12']);
  });
});
