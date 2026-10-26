import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
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
  let products: ProductsService;

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

    // ProductsService vẫn dựng (cache trong bộ nhớ) để bài kiểm cache còn ý
    // nghĩa: nó làm ấm cache, rồi CartService phải KHÔNG đọc từ đó.
    products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      notifications,
      createCache({ ttl: 30_000 }),
      khoPhat,
    );
    cart = new CartService(ds.getRepository(Cart));
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

  // ─── GIỎ KHÔNG ĐƯỢC GIỮ NHIỀU HƠN KHO HIỆN TẠI (26/10) ─────────────────────
  //
  // Ảnh chụp giỏ web ngày 26/10: nồi chiên 20.000đ, ô số lượng hiện 7, dòng ghi
  // "Chỉ còn 4 cái, giỏ đang để 7", thành tiền 80.000đ (4 x 20.000). Giỏ giữ 7
  // khi kho còn 4, giao diện hiện một số nhưng tính tiền theo số khác. Ba đường
  // dẫn tới đó, mỗi đường một bài kiểm dưới đây:
  //
  //   · `create` đọc kho qua `ProductsService.findOne`, bản cache ~60s trong
  //     Redis: kho vừa giảm mà cache còn số cũ thì vẫn nhận.
  //   · `create` cộng dồn kiểu đọc rồi ghi: hai lần bấm sát nhau cùng đọc một
  //     số cũ, cùng qua kiểm, lần sau ghi đè lần trước.
  //   · kho giảm SAU khi đã bỏ vào giỏ (người khác mua mất): không ai hạ dòng
  //     giỏ xuống, nên `findAll` trả về 7 trong khi kho còn 4.

  async function soTrongGio(pid: number): Promise<number | undefined> {
    const rows = await ds.query<Array<{ quantity: number }>>(
      'SELECT quantity FROM carts WHERE user_id = ? AND product_id = ?',
      [buyerId, pid],
    );
    return rows[0] ? Number(rows[0].quantity) : undefined;
  }

  async function datThangVaoGio(pid: number, soLuong: number): Promise<void> {
    await ds.query(
      'INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)',
      [buyerId, pid, soLuong],
    );
  }

  it('kho vừa giảm thì "Thêm vào giỏ" phải thấy số mới, không đọc bản cache', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE, 5);
    // Lần đầu: ProductsService.findOne đưa sản phẩm (kho 5) vào cache.
    await products.findOne(pid);
    await cart.create({ product_id: pid, quantity: 1 }, nguoiMua());

    // Người khác mua hết, kho trong database còn 1. Cache vẫn ghi 5.
    await ds.query('UPDATE products SET stock = 1 WHERE id = ?', [pid]);

    await expect(
      cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
    ).rejects.toThrow(BadRequestException);
    expect(await soTrongGio(pid)).toBe(1);
  });

  it('mười lần bấm "Thêm" cùng lúc vào dòng đã có: không mất lượt nào', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE, 50);
    await cart.create({ product_id: pid, quantity: 1 }, nguoiMua());

    const kq = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
      ),
    );
    const thanhCong = kq.filter((k) => k.status === 'fulfilled').length;

    expect(thanhCong).toBe(10);
    expect(await soTrongGio(pid)).toBe(11);
  });

  it('bấm "Thêm" cùng lúc sát trần kho: số trong giỏ khớp số lần thành công và không vượt kho', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE, 5);
    await cart.create({ product_id: pid, quantity: 1 }, nguoiMua());

    const kq = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
      ),
    );
    const thanhCong = kq.filter((k) => k.status === 'fulfilled').length;
    const trongGio = await soTrongGio(pid);

    expect(trongGio).toBe(1 + thanhCong);
    expect(trongGio).toBe(5);
    expect(thanhCong).toBe(4);
  });

  it('lần thêm ĐẦU TIÊN bấm cùng lúc (chưa có dòng giỏ): không lần nào nổ trùng khoá', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE, 50);

    const kq = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
      ),
    );
    const loi = kq
      .filter((k): k is PromiseRejectedResult => k.status === 'rejected')
      .map((k) => (k.reason as Error).message);

    expect(loi).toEqual([]);
    expect(await soTrongGio(pid)).toBe(5);
  });

  it('dòng giỏ đã bằng kho thì từ chối và nói rõ giỏ đang có bao nhiêu', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE, 4);
    await cart.create({ product_id: pid, quantity: 4 }, nguoiMua());

    await expect(
      cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
    ).rejects.toThrow('Giỏ của bạn đã có 4 cái, bằng số còn trong kho');
    expect(await soTrongGio(pid)).toBe(4);
  });

  it('dòng giỏ đã VƯỢT kho (kho giảm sau khi bỏ vào giỏ) thì "Thêm" cũng từ chối, không cộng tiếp', async () => {
    const pid = await taoSanPham(ProductStatus.ACTIVE, 4);
    await datThangVaoGio(pid, 7);

    await expect(
      cart.create({ product_id: pid, quantity: 1 }, nguoiMua()),
    ).rejects.toThrow('Giỏ của bạn đã có 7 cái');
  });

  it('findAll hạ dòng vượt kho xuống bằng kho, ghi vào database và báo số cũ', async () => {
    const vuot = await taoSanPham(ProductStatus.ACTIVE, 4);
    const hetHang = await taoSanPham(ProductStatus.ACTIVE, 0);
    const ngungBan = await taoSanPham(ProductStatus.PENDING, 4);
    const daXoa = await taoSanPham(ProductStatus.ACTIVE, 4);
    const binhThuong = await taoSanPham(ProductStatus.ACTIVE, 10);

    await datThangVaoGio(vuot, 7);
    await datThangVaoGio(hetHang, 3);
    await datThangVaoGio(ngungBan, 7);
    await datThangVaoGio(daXoa, 7);
    await datThangVaoGio(binhThuong, 2);
    await ds.query('UPDATE products SET deleted_at = NOW() WHERE id = ?', [
      daXoa,
    ]);

    const { meta, result } = await cart.findAll(nguoiMua());
    expect(meta.total).toBe(5);

    const dongCua = async (pid: number) => {
      const [row] = await ds.query<Array<{ id: number }>>(
        'SELECT id FROM carts WHERE user_id = ? AND product_id = ?',
        [buyerId, pid],
      );
      const dong = result.find((d) => d.id === row.id);
      if (!dong) throw new Error(`findAll thiếu dòng của sản phẩm ${pid}`);
      return dong as typeof dong & { quantity_adjusted_from?: number };
    };

    const dVuot = await dongCua(vuot);
    expect(dVuot.quantity).toBe(4);
    expect(dVuot.quantity_adjusted_from).toBe(7);
    expect(await soTrongGio(vuot)).toBe(4);

    // Hết hàng, ngừng bán, đã xoá: để nguyên, client hiện "hết hàng" và loại
    // khỏi tổng tiền. Hạ về 0 là xoá mất ý định mua của người ta.
    for (const pid of [hetHang, ngungBan, daXoa]) {
      const d = await dongCua(pid);
      expect(d).not.toHaveProperty('quantity_adjusted_from');
    }
    expect(await soTrongGio(hetHang)).toBe(3);
    expect(await soTrongGio(ngungBan)).toBe(7);
    expect(await soTrongGio(daXoa)).toBe(7);

    const dThuong = await dongCua(binhThuong);
    expect(dThuong.quantity).toBe(2);
    expect(dThuong).not.toHaveProperty('quantity_adjusted_from');
  });
});
