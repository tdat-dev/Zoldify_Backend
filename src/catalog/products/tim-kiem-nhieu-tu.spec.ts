import { DataSource } from 'typeorm';
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
 * Tìm nhiều từ phải khớp ĐỦ các từ dài (đợt đo 1 triệu dòng, 02/11): bài kiểm
 * viết TRƯỚC.
 *
 * Câu FULLTEXT gửi `tai* nghe*` ở BOOLEAN MODE, tức là HOẶC: món nào có "tai"
 * hoặc có "nghe" đều khớp. Trên 1.001.015 sản phẩm (zoldify_1mall), "sneaker
 * cao cấp" khớp gần nửa bảng và câu chọn trang mất 3.976 ms (phải đọc từng
 * dòng khớp để lọc trạng thái rồi sắp theo created_at); bắt buộc đủ từ
 * (`+sneaker* +cao* +cấp*`) còn 895 ms. Dưới tải (`npm run loadtest` chế độ
 * 1M) route tìm kiếm p95 4.586 ms một người gọi, 500 ở 20 kết nối.
 *
 * Kết quả HOẶC còn sai về nghĩa: gõ "tai nghe" mà ra "Tai lợn" và "Nghe nhạc".
 *
 * Từ ngắn hơn `innodb_ft_min_token_size` không được gắn `+`: InnoDB không
 * index chúng, bắt buộc một từ không có trong index là không ra gì.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('Tìm nhiều từ: khớp đủ các từ dài', () => {
  let ds: DataSource;
  let sellerId: number;
  const R = Math.floor(Math.random() * 1e6);
  const MA = `zq${R}`;

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
      logging: false,
    });
    await ds.initialize();
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('ban', ?, 'x', ?)`,
      [`tknt-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    const ten = [
      `Tai nghe bluetooth ${MA}`,
      `Tai nghe có dây ${MA}`,
      `Tai lợn xông khói ${MA}`,
      `Nghe nhạc không dây ${MA}`,
      `Áo khoác ${MA}`,
    ];
    for (const [i, t] of ten.entries()) {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, status, seller_id, created_at)
         VALUES (?, ?, 1000, 5, ?, ?, NOW() - INTERVAL ? MINUTE)`,
        [t, `tknt-${R}-${i}`, ProductStatus.ACTIVE, sellerId, i],
      );
    }
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM products WHERE seller_id = ?', [sellerId]);
      await ds.query('DELETE FROM users WHERE id = ?', [sellerId]);
      await ds.destroy();
    }
  });

  type Ket = { meta: { total: number }; result: Array<{ name: string }> };

  it('"tai nghe <mã>" chỉ ra hai món tai nghe, mới nhất trước', async () => {
    const kq = (await moi().findAll('1', '20', {
      q: `tai nghe ${MA}`,
    })) as Ket;
    expect(kq.result.map((p) => p.name)).toEqual([
      `Tai nghe bluetooth ${MA}`,
      `Tai nghe có dây ${MA}`,
    ]);
    expect(kq.meta.total).toBe(2);
  });

  it('từ ngắn đi kèm không làm mất kết quả: "áo khoác <mã>"', async () => {
    const kq = (await moi().findAll('1', '20', {
      q: `áo khoác ${MA}`,
    })) as Ket;
    expect(kq.result.map((p) => p.name)).toEqual([`Áo khoác ${MA}`]);
  });
});
