import { DataSource } from 'typeorm';
import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';
import { ProductsService } from '@catalog/products/products.service';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { createCache } from 'cache-manager';

/**
 * Stub của `StockEventsService` cho mọi chỗ tự new service thay vì để bộ tiêm phụ thuộc dựng.
 *
 * VÌ SAO PHẢI CÓ, KHI npm test ĐÃ XANH MÀ KHÔNG CÓ NÓ.
 *
 * Đo ngày 07/10: thiếu đối số này, ts-jest KHÔNG báo lỗi TS2554 — bốn spec vẫn
 * xanh với this.stockEvents === undefined, và chỉ nổ vào ngày có người thêm một
 * ca chạm tới đường dẫn gọi phat(). Cùng khiếm khuyết đó thì ts-node (dùng cho
 * scripts/) BÁO NGAY, nên check:cache đỏ còn npm test xanh — hai công cụ, hai
 * câu trả lời, cho cùng một dòng mã.
 *
 * resolve chứ không reject: cả ba chỗ gọi đều await nó, và chúng nằm NGAY SAU
 * khi transaction đã commit.
 */
const khoPhat = { phat: () => Promise.resolve() } as never;

/**
 * BÀI KIỂM ĐỎ — BUG-22. Giỏ hàng không kiểm gì ngoài "có phải hàng của mình".
 *
 * `cart.service.ts` kiểm đúng hai thứ: sản phẩm có tồn tại, và người mua không
 * phải người bán. Nó KHÔNG kiểm:
 *
 *   · `product.status` — thêm được hàng `draft`, `pending`, `rejected` vào giỏ
 *   · `product.stock`  — thêm được 9.999 món khi kho còn 5
 *   · cộng dồn         — `existingCart.quantity += quantity` không có trần
 *
 * Vì sao vẫn đáng sửa dù `orders.create` đã chặn hết ở bước đặt hàng: người mua
 * chỉ biết mình không mua được ở màn THANH TOÁN, sau khi đã chọn địa chỉ và
 * phương thức trả tiền. Báo lỗi ở đúng lúc họ bấm "Thêm vào giỏ" thì họ còn
 * đang ở trang sản phẩm và chọn được món khác.
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

jest.setTimeout(60_000);

describe('CartService — giỏ hàng phải kiểm trước khi nhận', () => {
  let ds: DataSource;
  let cart: CartService;

  let buyerId: number;
  let sellerId: number;
  let categoryId: number;

  const KHO = 5;

  const nguoiMua = (): IUser => ({
    id: buyerId,
    full_name: 'buyer',
    email: 'buyer@t.local',
    role: UserRole.BUYER,
    avatar: '',
  });

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, Category, Product, Follow, Shop, Cart],
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
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
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

    buyerId = await taoUser('buyer@t.local', UserRole.BUYER);
    sellerId = await taoUser('seller@t.local', UserRole.SELLER);

    await ds.query(
      `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat')`,
    );
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories LIMIT 1',
    );
    categoryId = c.id;

    const notifications = {
      create: () => Promise.resolve(undefined),
    } as unknown as NotificationsService;

    const products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      notifications,
      createCache({ ttl: 30_000 }),
      khoPhat,
    );
    cart = new CartService(ds.getRepository(Cart), products);
  });

  async function taoUser(email: string, role: UserRole): Promise<number> {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
      [email, email, role],
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    return u.id;
  }

  async function taoSanPham(status: ProductStatus, kho = KHO): Promise<number> {
    const slug = `sp-${status}-${Math.floor(Math.random() * 1e9)}`;
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES (?, ?, 100000, ?, ?, ?, ?)`,
      [slug, slug, kho, status, categoryId, sellerId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM products WHERE slug = ?',
      [slug],
    );
    return p.id;
  }

  it('không thêm được hàng CHƯA MỞ BÁN vào giỏ', async () => {
    for (const st of [
      ProductStatus.DRAFT,
      ProductStatus.PENDING,
      ProductStatus.REJECTED,
    ]) {
      const pid = await taoSanPham(st);
      await expect(
        cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
      ).rejects.toThrow();
    }
  });

  it('không thêm được nhiều hơn tồn kho', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE);
    await expect(
      cart.create({ product_id: pid, quantity: KHO + 1 }, nguoiMua()),
    ).rejects.toThrow();
  });

  /**
   * `existingCart.quantity += quantity || 1` không có trần. Bấm "Thêm vào giỏ"
   * đủ nhiều lần là giỏ có số lượng lớn hơn kho, và người mua chỉ biết ở màn
   * thanh toán.
   */
  it('cộng dồn nhiều lần cũng không vượt được tồn kho', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE);

    for (let i = 0; i < KHO; i++) {
      await cart.create({ product_id: pid, quantity: 1 }, nguoiMua());
    }

    // Lần thứ KHO + 1 phải bị từ chối.
    await expect(
      cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
    ).rejects.toThrow();

    const [row] = await ds.query<Array<{ quantity: number }>>(
      'SELECT quantity FROM carts WHERE user_id = ? AND product_id = ?',
      [buyerId, pid],
    );
    expect(Number(row.quantity)).toBeLessThanOrEqual(KHO);
  });

  it('update cũng không đặt được số lượng vượt kho', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE);
    const item = await cart.create(
      { product_id: pid, quantity: 1 },
      nguoiMua(),
    );

    await expect(
      cart.update(item.id, { quantity: KHO + 10 }, nguoiMua()),
    ).rejects.toThrow();
  });

  it('[đối chứng] thêm hàng hợp lệ vẫn chạy bình thường', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE);
    const item = await cart.create(
      { product_id: pid, quantity: 2 },
      nguoiMua(),
    );
    expect(item.quantity).toBe(2);
  });
});
