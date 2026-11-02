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
 * Tìm nhiều chữ phải khớp ĐỦ các chữ (D-17, E2E mobile 02/11).
 *
 * Gõ "noi chien" trên app ra "Tay cầm chơi game Nintendo cũ" và "Loa bluetooth
 * JBL cũ" đứng đầu; API trả 87 món, gồm cả nồi cơm, máy xay. Lý do: chuỗi đưa
 * vào `MATCH ... IN BOOLEAN MODE` là `noi* chien*`, mà ở chế độ boolean hai chữ
 * KHÔNG có dấu `+` nghĩa là "chữ nào cũng được". Mô tả "kết nối bluetooth" có
 * chữ `nối`, khớp `noi*` (collation bỏ dấu), thế là tay cầm lọt vào.
 *
 * Ba cái bẫy đo được trên MySQL 8.4 (bảng thử, collation utf8mb4_unicode_ci),
 * bài kiểm khoá cả ba:
 *  - Chữ dưới 3 ký tự (`áo`, `đồ`, `xe`) không vào chỉ mục FULLTEXT
 *    (innodb_ft_min_token_size = 3). Gắn `+` cho nó thì RỖNG cả kết quả.
 *  - `đ` KHÔNG bằng `d` trong chỉ mục FULLTEXT dù `'đ' = 'd'` ở phép so sánh
 *    thường: `den*` không ra "Đèn bàn", `dien*` không ra "Nồi cơm điện".
 *  - `cơm`, `thẻ` trùng stopword tiếng Anh (`com`, `the`) nhưng có `*` thì vẫn
 *    khớp, nên không cần bỏ chúng đi.
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

describe('ProductsService — tìm nhiều chữ phải khớp đủ các chữ (D-17)', () => {
  let ds: DataSource;
  let svc: ProductsService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Product, Category, Shop, Follow, User],
      synchronize: true,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    // Chỉ mục FULLTEXT do migration 1700000000001 dựng, entity không khai nên
    // `synchronize` không tạo. Database test mới tinh thì phải tự dựng.
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
       VALUES ('nguoi ban','s-tim@t.local','x','seller')`,
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users ORDER BY id DESC LIMIT 1',
    );
    await ds.query(
      `INSERT INTO categories (name, slug, is_active) VALUES ('do','do-tim',1)`,
    );
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories ORDER BY id DESC LIMIT 1',
    );

    const hang: Array<[string, string]> = [
      ['Nồi chiên không dầu Philips 4L', 'Còn mới, chiên giòn'],
      ['Tay cầm chơi game Nintendo cũ', 'Kết nối bluetooth ổn định'],
      ['Loa bluetooth JBL cũ', 'Kết nối nhanh, pin trâu'],
      ['Nồi cơm điện Zojirushi', 'Nấu cơm ngon'],
      ['Đèn bàn học chống cận', 'Ánh sáng vàng'],
      ['Áo khoác jean nam', 'Size L'],
      ['Khoác gió thể thao', 'Chống nước'],
    ];
    let i = 0;
    for (const [name, description] of hang) {
      await ds.query(
        `INSERT INTO products (name, slug, description, price, stock, seller_id, category_id, status)
         VALUES (?, ?, ?, ?, 5, ?, ?, 'active')`,
        [name, `tim-${i}`, description, (i + 1) * 1000, u.id, c.id],
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

  const ten = async (q: string, sort?: string): Promise<string[]> => {
    const r = (await svc.findAll('1', '20', { q, sort })) as {
      result: Array<{ name: string }>;
    };
    return r.result.map((p) => p.name);
  };

  it('"noi chien" chỉ ra nồi chiên, không ra tay cầm/loa có chữ "kết nối"', async () => {
    expect(await ten('noi chien')).toEqual(['Nồi chiên không dầu Philips 4L']);
  });

  it('sắp theo giá cũng không kéo món lạc đề lên', async () => {
    expect(await ten('noi chien', 'price_desc')).toEqual([
      'Nồi chiên không dầu Philips 4L',
    ]);
  });

  it('gõ có dấu hay in hoa đều ra cùng kết quả', async () => {
    expect(await ten('nồi chiên')).toEqual(['Nồi chiên không dầu Philips 4L']);
    expect(await ten('NOI CHIEN')).toEqual(['Nồi chiên không dầu Philips 4L']);
  });

  it('"d" gõ không dấu vẫn khớp "đ" (đèn, điện)', async () => {
    expect(await ten('den ban')).toEqual(['Đèn bàn học chống cận']);
    expect(await ten('noi com dien')).toEqual(['Nồi cơm điện Zojirushi']);
  });

  it('chữ ngắn dưới 3 ký tự không làm rỗng kết quả, và vẫn được tính', async () => {
    // "áo" không vào chỉ mục FULLTEXT; nếu bị gắn `+` thì kết quả rỗng, còn nếu
    // bị bỏ qua hẳn thì "Khoác gió" (không có chữ áo) lọt vào.
    expect(await ten('ao khoac')).toEqual(['Áo khoác jean nam']);
  });

  it('một chữ thì vẫn tìm như cũ', async () => {
    expect((await ten('khoac')).sort()).toEqual(
      ['Áo khoác jean nam', 'Khoác gió thể thao'].sort(),
    );
  });
});
