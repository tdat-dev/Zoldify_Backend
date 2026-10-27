import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { Product, ProductStatus } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { User, UserRole } from '@identity/users/entities/user.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * GET /products/:id trả cả sản phẩm NHÁP, chờ duyệt, bị từ chối cho bất kỳ ai.
 *
 * Route công khai, `findOne` không nhìn `status`: ai đoán được id là đọc được
 * sản phẩm người bán chưa đăng (giá, mô tả, ảnh chưa muốn công bố), hay sản
 * phẩm admin đã từ chối vì vi phạm. Danh sách thì đã lọc `active` từ lâu, chỉ
 * trang chi tiết sót.
 *
 * Nhưng KHÔNG được chặn luôn chủ sản phẩm: trang sửa sản phẩm của web gọi
 * đúng GET /products/:id (kèm token) để nạp form. Chủ và admin vẫn đọc được;
 * và bản họ đọc KHÔNG được vào cache chung, nếu không người lạ đọc ra từ
 * cache trong 60 giây sau đó.
 *
 * Chạy trên MySQL thật, cache trong bộ nhớ thật (cache-manager).
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

type NguoiXem = { user?: IUser | null; tokenHong?: boolean };

describe('Chi tiết sản phẩm chưa mở bán', () => {
  let ds: DataSource;
  let products: ProductsService;
  let xem: (id: number, n?: NguoiXem) => Promise<Product>;
  let sellerId: number;
  let catId: number;

  const R = Math.floor(Math.random() * 1e6);

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, Category, Product, Follow, Shop],
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
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('ban', ?, 'x', ?)`,
      [`ban-an-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    // Tên danh mục cũng UNIQUE: dùng chung chuỗi ngẫu nhiên với slug.
    await ds.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
      `C an ${R}`,
      `c-an-${R}`,
    ]);
    catId = await idVuaChen();
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM products WHERE seller_id = ?', [sellerId]);
      await ds.query('DELETE FROM categories WHERE id = ?', [catId]);
      await ds.query('DELETE FROM users WHERE id = ?', [sellerId]);
      await ds.destroy();
    }
  });

  beforeEach(() => {
    // Cache mới mỗi bài: bài này đo chính cache, không để bài trước rò sang.
    products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      {} as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );
    // Tham số thứ hai là người xem; ép kiểu để bài kiểm biên dịch được cả
    // trước khi `findOne` nhận nó (đỏ vì hành vi, không vì TypeScript).
    xem = products.findOne.bind(products) as typeof xem;
  });

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  async function taoSanPham(status: ProductStatus): Promise<number> {
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('SP', ?, 1000, 5, ?, ?, ?)`,
      [`sp-an-${R}-${Math.random()}`, status, catId, sellerId],
    );
    return idVuaChen();
  }

  const chu = (): IUser => ({ id: sellerId, role: 'seller' }) as IUser;
  const nguoiLa = (): IUser =>
    ({ id: sellerId + 999_999, role: 'seller' }) as IUser;
  const quanTri = (): IUser =>
    ({ id: sellerId + 888_888, role: 'admin' }) as IUser;

  it.each([ProductStatus.DRAFT, ProductStatus.PENDING, ProductStatus.REJECTED])(
    'khách vãng lai mở sản phẩm "%s" → 404',
    async (st) => {
      const id = await taoSanPham(st);
      await expect(xem(id)).rejects.toBeInstanceOf(NotFoundException);
      await expect(xem(id, { user: nguoiLa() })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('sản phẩm đang bán thì ai cũng xem được', async () => {
    const id = await taoSanPham(ProductStatus.ACTIVE);
    expect((await xem(id)).id).toBe(id);
  });

  it('chủ sản phẩm và admin vẫn mở được bản nháp (trang sửa cần)', async () => {
    const id = await taoSanPham(ProductStatus.DRAFT);
    expect((await xem(id, { user: chu() })).id).toBe(id);
    expect((await xem(id, { user: quanTri() })).id).toBe(id);
  });

  it('bản chủ sản phẩm vừa đọc KHÔNG rò ra cache cho người lạ', async () => {
    const id = await taoSanPham(ProductStatus.DRAFT);
    await xem(id, { user: chu() });
    await expect(xem(id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sản phẩm đang bán bị gỡ xuống nháp thì khách thấy 404 ngay', async () => {
    const id = await taoSanPham(ProductStatus.ACTIVE);
    await xem(id);
    await ds.query(`UPDATE products SET status = 'draft' WHERE id = ?`, [id]);
    await products.invalidateProductCache(id);
    await expect(xem(id)).rejects.toBeInstanceOf(NotFoundException);
  });

  // Review 27/10 (B): bản đầu trả 401 cho token hỏng + bản nháp. Hai cái sai:
  //  - 401 ở bản nháp nhưng 404 ở id không có thật là CHỈ ĐIỂM: dò id kèm một
  //    token rác là biết id nào là bản nháp đang nằm đó.
  //  - Web và app KHÔNG có luồng làm mới token: gặp 401 bất kỳ là xoá phiên,
  //    đẩy về màn đăng nhập. Người mua token hết hạn bấm link tới sản phẩm của
  //    người bán bị khoá (hàng bị đưa về nháp) là bị đăng xuất.
  // Nên: route này không bao giờ 401, và bản nháp với người ngoài trông y hệt
  // id không tồn tại.
  it('token hỏng mà mở bản nháp → 404 y hệt id không tồn tại, không 401', async () => {
    const id = await taoSanPham(ProductStatus.DRAFT);
    const loiNhap = await xem(id, { tokenHong: true }).catch((e: unknown) => e);
    expect(loiNhap).toBeInstanceOf(NotFoundException);
    expect(loiNhap).not.toBeInstanceOf(UnauthorizedException);

    // Cùng thân lỗi với một id không có thật (khác mỗi con số id).
    const idMa = id + 10_000_000;
    const loiMa = await xem(idMa).catch((e: unknown) => e);
    expect(loiMa).toBeInstanceOf(NotFoundException);
    expect((loiNhap as NotFoundException).getResponse()).toEqual(
      JSON.parse(
        JSON.stringify((loiMa as NotFoundException).getResponse()).replace(
          String(idMa),
          String(id),
        ),
      ),
    );
  });

  it('chủ xem bản nháp qua controller → Cache-Control: private, no-store', async () => {
    const id = await taoSanPham(ProductStatus.DRAFT);
    const header: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        header[k.toLowerCase()] = v;
      },
    };
    const controller = new ProductsController(products);
    const xemQuaController = controller.findOne.bind(controller) as (
      id: number,
      req: unknown,
      res: unknown,
    ) => Promise<Product>;

    await xemQuaController(id, { user: chu() }, res);
    expect(header['cache-control']).toBe('private, no-store');

    // Sản phẩm đang bán (công khai) thì không ép gì, để CDN/trình duyệt
    // cache được như trước.
    const idBan = await taoSanPham(ProductStatus.ACTIVE);
    delete header['cache-control'];
    await xemQuaController(idBan, {}, res);
    expect(header['cache-control']).toBeUndefined();
  });
});
