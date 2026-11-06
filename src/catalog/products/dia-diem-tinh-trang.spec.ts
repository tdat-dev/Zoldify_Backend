import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { toSlug } from '@common/slug';

/**
 * Địa điểm và ghi chú tình trạng của tin đăng: bài kiểm viết TRƯỚC.
 *
 * VÌ SAO ĐỊA ĐIỂM DO SERVER ĐIỀN. Trang đích theo tỉnh cần biết món ở đâu, và
 * người bán đã khai địa chỉ lấy hàng ở shop. Chép xuống tin lúc đăng để lọc theo
 * tỉnh không phải nối bảng shops trên 1 triệu dòng, và tin không đổi nơi khi
 * người bán chuyển nhà.
 *
 * VÌ SAO KHÔNG TRƯỜNG MỚI NÀO BẮT BUỘC Ở SERVER. App Android không có cập nhật
 * bắt buộc, và bản đang chạy gửi `used` cho tình trạng. Bắt buộc hay từ chối ở
 * đây là bản cũ nhận 400 mà người dùng không biết sửa gì.
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

describe('toSlug phải khớp web', () => {
  it.each([
    ['Hồ Chí Minh', 'ho-chi-minh'],
    ['Đà Nẵng', 'da-nang'],
    ['Thành phố Hưng Yên', 'thanh-pho-hung-yen'],
    ['Nồi cơm điện 1.5L', 'noi-com-dien-15l'],
  ])('%s', (vao, ra) => {
    expect(toSlug(vao)).toBe(ra);
  });
});

describe('CreateProductDto: ghi chú tình trạng', () => {
  const hopLe = { name: 'Ao', price: 150_000, category_id: 1 };
  const loiCua = async (obj: Record<string, unknown>) =>
    (
      await validate(plainToInstance(CreateProductDto, obj), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('nhận ghi chú và cũng nhận khi không có, để app cũ không lỗi', async () => {
    expect(await loiCua({ ...hopLe, condition_note: 'Xước nhẹ' })).toEqual([]);
    expect(await loiCua(hopLe)).toEqual([]);
  });

  it('ghi chú quá 500 ký tự bị từ chối', async () => {
    expect(
      await loiCua({ ...hopLe, condition_note: 'x'.repeat(501) }),
    ).toContain('condition_note');
  });

  it('client không được tự khai địa điểm', async () => {
    expect(await loiCua({ ...hopLe, province_name: 'Ha Noi' })).toContain(
      'province_name',
    );
  });
});

describe('ProductsService: địa điểm và tình trạng', () => {
  let ds: DataSource;
  let svc: ProductsService;
  let nguoiBan: IUser;
  let catId: number;

  const dang = (them: Record<string, unknown> = {}) =>
    svc.create(
      {
        name: `Mon ${Math.random()}`,
        price: 100_000,
        category_id: catId,
        ...them,
      } as CreateProductDto,
      nguoiBan,
    );

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Product, Category, Shop, Follow, User],
      synchronize: true,
    });
    await ds.initialize();

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['products', 'follows', 'shops', 'categories', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    const u = await ds.query<{ insertId: number }>(
      "INSERT INTO users (full_name, email, password, role) VALUES ('Ban','dd@t.local','x','seller')",
    );
    const c = await ds.query<{ insertId: number }>(
      "INSERT INTO categories (name, slug, is_active) VALUES ('Dien thoai','dien-thoai-dd',1)",
    );
    catId = c.insertId;
    await ds.query(
      `INSERT INTO shops (name, slug, status, user_id, pickup_name, pickup_phone,
         pickup_address, pickup_province_name, pickup_district_name, pickup_ward_name)
       VALUES ('shop','shop-dd','active',?,'Ban','0900000000','So 1','Hồ Chí Minh','Quận Gò Vấp','P1')`,
      [u.insertId],
    );
    nguoiBan = {
      id: u.insertId,
      email: 'dd@t.local',
      full_name: 'Ban',
      role: UserRole.SELLER,
    } as unknown as IUser;

    svc = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      { create: async () => ({}) } as unknown as NotificationsService,
      createCache(),
      { phat: async () => undefined } as unknown as StockEventsService,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('đăng tin thì chép tỉnh, quận từ địa chỉ lấy hàng của shop', async () => {
    const p = await dang();
    expect(p).toMatchObject({
      province_name: 'Hồ Chí Minh',
      province_slug: 'ho-chi-minh',
      district_name: 'Quận Gò Vấp',
    });
  });

  it('đăng kiểu app cũ, không có trường mới, vẫn thành công', async () => {
    const p = await dang({ condition: 'good' });
    expect(p.id).toBeGreaterThan(0);
    expect(p.condition_note).toBeNull();
  });

  it('lưu ghi chú tình trạng', async () => {
    const p = await dang({ condition: 'fair', condition_note: 'Sờn góc' });
    expect(p.condition_note).toBe('Sờn góc');
  });

  it.each([
    ['used', 'good'],
    ['refurbished', 'good'],
    ['linh tinh', 'good'],
    ['like_new', 'like_new'],
    ['fair', 'fair'],
    ['new', 'new'],
  ])('đăng với tình trạng %s thì lưu %s', async (vao, ra) => {
    const p = await dang({ condition: vao });
    expect(p.condition).toBe(ra);
  });

  it('sửa tin: tình trạng lạ được đổi, địa điểm giữ nguyên', async () => {
    const p = await dang({ condition: 'good' });
    await ds.query(
      "UPDATE shops SET pickup_province_name = 'Hà Nội' WHERE user_id = ?",
      [nguoiBan.id],
    );
    try {
      const sua = await svc.update(
        p.id,
        { condition: 'used', condition_note: 'Pin yếu' },
        nguoiBan,
      );
      expect(sua.condition).toBe('good');
      expect(sua.condition_note).toBe('Pin yếu');
      expect(sua.province_name).toBe('Hồ Chí Minh');
    } finally {
      await ds.query(
        "UPDATE shops SET pickup_province_name = 'Hồ Chí Minh' WHERE user_id = ?",
        [nguoiBan.id],
      );
    }
  });
});
