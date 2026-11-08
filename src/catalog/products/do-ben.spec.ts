import { BadRequestException } from '@nestjs/common';
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

/**
 * Thẻ "Độ bền" của tin đăng: bài kiểm viết TRƯỚC.
 *
 * Ghi chú tình trạng (một ô chữ tự do, 06/11) không so được giữa hai tin: người
 * này ghi "pin ổn", người kia "pin 87%". Người mua đồ cũ hỏi đúng mấy câu: pin
 * còn bao nhiêu, dùng bao lâu, còn bảo hành không, lỗi gì, kèm gì, sửa chưa.
 * Mỗi câu một trường có kiểu thì web và app hiện thành bảng, sau này lọc được.
 *
 * Pin chỉ hỏi ở hàng có pin: áo hay chảo mà khai "pin 90%" là dữ liệu rác lọt
 * lên trang công khai.
 *
 * KHÔNG TRƯỜNG NÀO BẮT BUỘC Ở SERVER, cùng lý do với ghi chú: app Android không
 * có cập nhật bắt buộc, bản đang chạy không gửi `condition_details`.
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

const DU_DO_BEN = {
  battery_health: 87,
  used_months: 14,
  warranty_months: 3,
  defects: ['Xước nhẹ cạnh trái'],
  accessories: ['Hộp', 'Cáp sạc'],
  repaired: false,
};

describe('CreateProductDto: độ bền', () => {
  const hopLe = { name: 'Ao', price: 150_000, category_id: 1 };
  const loiCua = async (obj: Record<string, unknown>) =>
    (
      await validate(plainToInstance(CreateProductDto, obj), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('nhận đủ các trường, và cũng nhận khi không gửi', async () => {
    expect(await loiCua({ ...hopLe, condition_details: DU_DO_BEN })).toEqual(
      [],
    );
    expect(await loiCua(hopLe)).toEqual([]);
  });

  it.each([
    ['pin quá 100%', { battery_health: 101 }],
    ['pin âm', { battery_health: -1 }],
    ['pin lẻ', { battery_health: 87.5 }],
    ['số tháng dùng là chữ', { used_months: '14' }],
    ['bảo hành quá 10 năm', { warranty_months: 121 }],
    ['quá 10 khuyết điểm', { defects: Array(11).fill('x') }],
    ['khuyết điểm quá 100 ký tự', { defects: ['x'.repeat(101)] }],
    ['phụ kiện không phải chuỗi', { accessories: [1] }],
    ['đã sửa không phải đúng/sai', { repaired: 'co' }],
    ['ghi chú sửa quá 200 ký tự', { repair_note: 'x'.repeat(201) }],
    ['trường lạ', { mau_sac: 'do' }],
  ])('từ chối %s', async (_ten, sai) => {
    expect(
      await loiCua({ ...hopLe, condition_details: { ...DU_DO_BEN, ...sai } }),
    ).toContain('condition_details');
  });
});

describe('ProductsService: độ bền và thang tình trạng', () => {
  let ds: DataSource;
  let svc: ProductsService;
  let nguoiBan: IUser;
  let dienThoai: number;
  let quanAo: number;

  const dang = (them: Record<string, unknown> = {}, cat = dienThoai) =>
    svc.create(
      {
        name: `Mon ${Math.random()}`,
        price: 100_000,
        category_id: cat,
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
      "INSERT INTO users (full_name, email, password, role) VALUES ('Ban','db@t.local','x','seller')",
    );
    // Slug thật của prod: nhóm có pin nhận theo slug danh mục.
    dienThoai = (
      await ds.query<{ insertId: number }>(
        "INSERT INTO categories (name, slug, is_active) VALUES ('Điện thoại','dien-thoai',1)",
      )
    ).insertId;
    quanAo = (
      await ds.query<{ insertId: number }>(
        "INSERT INTO categories (name, slug, is_active) VALUES ('Quần áo','quan-ao',1)",
      )
    ).insertId;
    await ds.query(
      `INSERT INTO shops (name, slug, status, user_id, pickup_name, pickup_phone,
         pickup_address, pickup_province_name, pickup_district_name, pickup_ward_name)
       VALUES ('shop','shop-db','active',?,'Ban','0900000000','So 1','Hồ Chí Minh','Quận Gò Vấp','P1')`,
      [u.insertId],
    );
    nguoiBan = {
      id: u.insertId,
      email: 'db@t.local',
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

  // Thang 6 mức của thẻ: Mới 100%, Như mới 99%, Tốt 95%, Khá 85-90%, Cũ 70-80%,
  // Tân trang. App đang chạy vẫn gửi `used`/`refurbished`; nay là mức thật nên
  // giữ nguyên, không còn ép về `good` như bản 06/11.
  it.each([
    ['used', 'used'],
    ['refurbished', 'refurbished'],
    ['linh tinh', 'good'],
  ])('đăng với tình trạng %s thì lưu %s', async (vao, ra) => {
    const p = await dang({ condition: vao });
    expect(p.condition).toBe(ra);
  });

  it('đăng kiểu app cũ, không gửi độ bền, thì độ bền rỗng', async () => {
    const p = await dang({ condition: 'good' });
    expect(p.condition_details).toBeNull();
  });

  it('lưu và trả lại độ bền, chuỗi được cắt khoảng trắng và bỏ dòng trống', async () => {
    const p = await dang({
      condition: 'good',
      condition_details: {
        ...DU_DO_BEN,
        defects: ['  Xước nhẹ cạnh trái ', '   '],
        accessories: ['Hộp', '', 'Cáp sạc'],
      },
    });
    expect(p.condition_details).toEqual(DU_DO_BEN);
  });

  it('gửi object rỗng thì coi như không khai', async () => {
    const p = await dang({ condition_details: { defects: [' '] } });
    expect(p.condition_details).toBeNull();
  });

  it('hàng không có pin mà khai pin thì 400', async () => {
    await expect(
      dang({ condition_details: { battery_health: 90 } }, quanAo),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hàng không có pin vẫn khai được các trường khác', async () => {
    const p = await dang(
      { condition_details: { used_months: 6, defects: ['Sờn cổ'] } },
      quanAo,
    );
    expect(p.condition_details).toEqual({
      used_months: 6,
      defects: ['Sờn cổ'],
    });
  });

  it('sửa tin: thay độ bền, không gửi thì giữ, gửi null thì xoá', async () => {
    const p = await dang({ condition_details: DU_DO_BEN });

    const thay = await svc.update(
      p.id,
      { condition_details: { battery_health: 80 } },
      nguoiBan,
    );
    expect(thay.condition_details).toEqual({ battery_health: 80 });

    const giu = await svc.update(p.id, { name: `Doi ten ${p.id}` }, nguoiBan);
    expect(giu.condition_details).toEqual({ battery_health: 80 });

    const xoa = await svc.update(
      p.id,
      { condition_details: null } as never,
      nguoiBan,
    );
    expect(xoa.condition_details).toBeNull();
  });

  it('sửa tin hàng không có pin mà khai pin thì 400', async () => {
    const p = await dang({}, quanAo);
    await expect(
      svc.update(p.id, { condition_details: { battery_health: 50 } }, nguoiBan),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
