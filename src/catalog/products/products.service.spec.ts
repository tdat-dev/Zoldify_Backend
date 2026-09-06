import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { createCache } from 'cache-manager';
import { ProductsService } from './products.service';
import { Product, ProductStatus } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { User } from '@identity/users/entities/user.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { IUser } from '@identity/users/users.interface';

/**
 * Cache danh sách sản phẩm — bài kiểm viết TRƯỚC.
 *
 * VÌ SAO CÓ BÀI NÀY.
 *
 * `findAll` bọc cache theo khoá gồm 8 tham số (trang, cỡ trang, sắp xếp, từ
 * khoá, danh mục, người bán, khoảng giá). Ba hàm ghi — `update`, `remove`,
 * `updateStock` — chỉ xoá khoá CHI TIẾT (`product:<id>`). **Không hàm nào đụng
 * tới cache danh sách**, và `create` thì không xoá gì cả.
 *
 * Hệ quả người dùng thấy: **người bán đăng hoặc sửa sản phẩm xong, tới 30 giây
 * sau danh sách mới đổi.** TTL 30s là thứ duy nhất chặn, và chú thích trong mã
 * nói thẳng điều đó: "list KHÔNG purge từng key ... nên TTL ngắn là lưới an
 * toàn cuối chống stale".
 *
 * Đó là đánh đổi có ý thức, không phải quên. Nhưng nó chọn sai phía: 30 giây là
 * lâu với người vừa bấm "Đăng bán" và không thấy hàng của mình đâu.
 *
 * VÌ SAO KHÔNG XOÁ TỪNG KHOÁ ĐƯỢC.
 *
 * Vì không liệt kê được khoá: 8 tham số nhân với số trang ra hàng nghìn khoá, và
 * `SCAN` trên Redis vừa đắt vừa không có trong giao diện của cache-manager. Nên
 * cách đúng là ĐỔI KHÔNG GIAN KHOÁ: thêm một "đời" vào khoá, ghi thì tăng đời,
 * mọi khoá đời cũ thành không ai với tới và tự hết hạn.
 *
 * HAI ĐIỀU BÀI KIỂM PHẢI KHẲNG ĐỊNH, VÀ VÌ SAO CẦN CẢ HAI.
 *
 *   1. Ghi xong thì danh sách phải mới NGAY — ở MỌI trang và MỌI bộ lọc, không
 *      riêng cái vừa đụng. Đây là chỗ mà xoá-từng-khoá không làm nổi.
 *   2. Nhưng cache vẫn phải CÒN TÁC DỤNG. Nếu thiếu điều này thì cách "sửa" rẻ
 *      nhất là tắt cache đi — bài kiểm sẽ xanh, và hiệu năng tụt 4,5 lần
 *      (đo được trong docs/system-design/load-test.md: 2.225 rps xuống 490).
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

/** Đếm riêng truy vấn ĐỌC DANH SÁCH sản phẩm — thứ mà cache phải chặn bớt. */
class DemTruyVanDanhSach implements TypeOrmLogger {
  public dem = 0;
  logQuery(q: string) {
    if (
      /^SELECT/i.test(q) &&
      /`?products`?/.test(q) &&
      !/^SELECT COUNT/i.test(q)
    )
      this.dem += 1;
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

describe('ProductsService — cache danh sách phải mới lại sau khi ghi', () => {
  let ds: DataSource;
  let svc: ProductsService;
  const dem = new DemTruyVanDanhSach();
  let sellerId: number;
  let nguoiBan: IUser;
  let idHang: number[] = [];

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Product, Category, Shop, Follow, User],
      synchronize: true,
      logging: ['query'],
      logger: dem,
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
    for (const t of ['products', 'follows', 'shops', 'categories', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ('nguoi ban','s@t.local','x','seller')`,
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users ORDER BY id DESC LIMIT 1',
    );
    sellerId = Number(u.id);
    nguoiBan = { id: sellerId, role: 'seller' } as IUser;

    await ds.query(
      `INSERT INTO categories (name, slug, is_active) VALUES ('do an','do-an',1)`,
    );
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories ORDER BY id DESC LIMIT 1',
    );

    for (let i = 0; i < 3; i++) {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, seller_id, category_id, status)
         VALUES (?, ?, ?, 5, ?, ?, 'active')`,
        [`San pham ${i}`, `san-pham-${i}`, (i + 1) * 1000, sellerId, c.id],
      );
    }
    const rows = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM products WHERE status='active' ORDER BY id",
    );
    idHang = rows.map((r) => Number(r.id));

    // Cache THẬT của cache-manager, không phải cái giả tự viết: điều cần kiểm là
    // hành vi của chính thư viện đang chạy trên production (kể cả `wrap`
    // single-flight), chứ không phải hành vi của một bản mô phỏng.
    const cache = createCache({ ttl: 30_000 });
    const thongBaoGia = {
      create: () => Promise.resolve(undefined),
    } as unknown as NotificationsService;

    svc = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      thongBaoGia,
      cache,
    );
    dem.dem = 0;
  });

  const ten = async (qs: Record<string, unknown> = {}): Promise<string[]> => {
    const r = (await svc.findAll('1', '10', qs)) as {
      result: Array<{ name: string }>;
    };
    return r.result.map((p) => p.name);
  };

  it('cache VẪN có tác dụng — gọi hai lần chỉ đọc database một lần', async () => {
    await ten();
    const sauLanDau = dem.dem;
    expect(sauLanDau).toBeGreaterThan(0);

    await ten();
    // Nếu con số này tăng nghĩa là cache không ăn — và cách "sửa" bằng việc tắt
    // cache đi sẽ bị chặn ngay ở đây. Đo được trong load-test.md: mất cache là
    // đường sản phẩm tụt từ 2.225 rps xuống 490.
    expect(dem.dem).toBe(sauLanDau);
  });

  it('sửa sản phẩm xong thì danh sách đổi NGAY, không đợi hết TTL', async () => {
    expect(await ten()).toContain('San pham 0');

    await svc.update(idHang[0], { name: 'Ten da doi' }, nguoiBan);

    expect(await ten()).toContain('Ten da doi');
  });

  it('xoá sản phẩm xong thì nó biến khỏi danh sách NGAY', async () => {
    expect(await ten()).toContain('San pham 1');

    await svc.remove(idHang[1], nguoiBan);

    expect(await ten()).not.toContain('San pham 1');
  });

  it('làm mới MỌI trang và MỌI bộ lọc, không chỉ cái vừa đụng', async () => {
    // Đây là lý do phải đổi không gian khoá thay vì xoá từng khoá: bốn khoá cache
    // khác nhau dưới đây đều phải mới lại sau MỘT lần ghi, mà không cách nào
    // liệt kê được chúng để xoá.
    const cacBoLoc: Array<Record<string, unknown>> = [
      {},
      { sort: 'price_asc' },
      { seller_id: String(sellerId) },
      { price_min: '1' },
    ];
    for (const f of cacBoLoc) expect(await ten(f)).toContain('San pham 2');

    await svc.update(idHang[2], { name: 'Doi het roi' }, nguoiBan);

    for (const f of cacBoLoc) {
      const ds2 = await ten(f);
      expect(ds2).toContain('Doi het roi');
      expect(ds2).not.toContain('San pham 2');
    }
  });

  it('đổi kho xong thì danh sách cũng mới lại', async () => {
    await ten();
    await svc.updateStock(idHang[0], 0, sellerId, false);

    const r = (await svc.findAll('1', '10', {})) as {
      result: Array<{ id: number; stock: number }>;
    };
    const mon = r.result.find((p) => p.id === idHang[0]);
    expect(mon?.stock).toBe(0);
  });

  it('đăng sản phẩm mới thì nó có mặt trong danh sách NGAY', async () => {
    // `create` cần người bán đã khai địa chỉ lấy hàng. `assertSellerHasPickup`
    // kiểm ĐÚNG 6 trường — và kiểm các trường `_name`, không phải `_id`/`_code`.
    await ds.query(
      `INSERT INTO shops (name, slug, status, user_id, pickup_name, pickup_phone,
        pickup_address, pickup_province_name, pickup_district_name, pickup_ward_name)
       VALUES ('shop','shop-1','active',?,'Nguoi ban','0900000000','So 1','Ha Noi','Cau Giay','Dich Vong')`,
      [sellerId],
    );
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories ORDER BY id DESC LIMIT 1',
    );

    expect(await ten()).not.toContain('Hang moi dang');

    await svc.create(
      {
        name: 'Hang moi dang',
        price: 9000,
        stock: 3,
        category_id: c.id,
        image: 'https://x/y.jpg',
        status: ProductStatus.ACTIVE,
      } as never,
      { ...nguoiBan, full_name: 'Nguoi ban' },
    );

    expect(await ten()).toContain('Hang moi dang');
  });
});
