import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { HangDoiViecNen, JOB_BAO_HANG_MOI } from '@common/hang-doi';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 6: đăng bán không được chờ báo cho từng
 * người theo dõi.
 *
 * `ProductsService.create` tới 26/10 làm `await Promise.all(followers.map(
 * notificationsService.create))` NGAY TRONG request POST /products. Mỗi lượt
 * là một INSERT notifications và một lần đẩy FCM; người bán có 5.000 người
 * theo dõi thì request giữ 5.000 lời hứa cùng lúc, hồ kết nối 50 của api cạn
 * sạch, và người bán chờ tới khi xong hết mới thấy "Đăng bán thành công".
 *
 * Nay: request chỉ XẾP một job vào hàng đợi; worker đi báo từng lô, có trần
 * số lời gọi chạy cùng lúc.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

describe('Báo hàng mới cho người theo dõi', () => {
  let ds: DataSource;
  let sellerId: number;
  let categoryId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, Category, Product, Shop, Follow],
      synchronize: true,
      logging: false,
    });
    await ds.initialize();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['follows', 'products', 'shops', 'categories', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('Shop A', 's@t.local', 'x', ?)`,
      [UserRole.SELLER],
    );
    const [s] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM users WHERE email = 's@t.local'`,
    );
    sellerId = s.id;
    await ds.query(
      `INSERT INTO shops (name, user_id, pickup_name, pickup_phone, pickup_address,
         pickup_ward_name, pickup_district_name, pickup_province_name)
       VALUES ('Shop A', ?, 'A', '0900000000', '1 duong', 'P1', 'Q1', 'HCM')`,
      [sellerId],
    );
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-tb')`);
    const [c] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    categoryId = c.id;
  });

  async function taoNguoiTheoDoi(n: number): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const email = `f${i}-${Date.now()}@t.local`;
      await ds.query(
        `INSERT INTO users (full_name, email, password, role) VALUES ('f', ?, 'x', 'buyer')`,
        [email],
      );
      const [u] = await ds.query<Array<{ id: number }>>(
        `SELECT id FROM users WHERE email = ?`,
        [email],
      );
      await ds.query(
        `INSERT INTO follows (follower_id, following_id) VALUES (?, ?)`,
        [u.id, sellerId],
      );
      ids.push(u.id);
    }
    return ids;
  }

  const nguoiBan = (): IUser => ({
    id: sellerId,
    full_name: 'Shop A',
    email: 's@t.local',
    role: UserRole.SELLER,
    avatar: '',
  });

  function dichVu(
    thongBao: Partial<NotificationsService>,
    hangDoi?: Pick<HangDoiViecNen, 'them'>,
  ) {
    return new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      thongBao as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
      hangDoi as HangDoiViecNen,
    );
  }

  it('POST /products không chờ báo từng người theo dõi, chỉ xếp MỘT job', async () => {
    await taoNguoiTheoDoi(3);
    let goiThongBao = 0;
    // Thông báo không bao giờ xong (FCM treo): đăng bán vẫn phải trả về.
    const thongBao = {
      create: () => {
        goiThongBao++;
        return new Promise(() => undefined);
      },
    } as unknown as Partial<NotificationsService>;
    const daXep: Array<{ ten: string; data: Record<string, unknown> }> = [];
    const hangDoi = {
      them: (ten: string, data: object) => {
        daXep.push({ ten, data: data as Record<string, unknown> });
        return Promise.resolve(true);
      },
    };

    const sp = await Promise.race([
      dichVu(thongBao, hangDoi).create(
        { name: 'Ao moi', price: 150_000, category_id: categoryId, stock: 2 },
        nguoiBan(),
      ),
      new Promise<'treo'>((r) => setTimeout(() => r('treo'), 3000)),
    ]);

    expect(sp).not.toBe('treo');
    expect(goiThongBao).toBe(0);
    expect(daXep).toHaveLength(1);
    expect(daXep[0].ten).toBe(JOB_BAO_HANG_MOI);
    expect(daXep[0].data).toMatchObject({
      seller_id: sellerId,
      product_name: 'Ao moi',
    });
  });

  it('worker báo đủ mọi người theo dõi, theo lô, không quá 10 lời gọi cùng lúc, một người hỏng không chặn người khác', async () => {
    const nguoi = await taoNguoiTheoDoi(45);
    let dangChay = 0;
    let caoNhat = 0;
    const daBao: number[] = [];
    const thongBao = {
      create: async (dto: { user_id: number }) => {
        dangChay++;
        caoNhat = Math.max(caoNhat, dangChay);
        await new Promise((r) => setTimeout(r, 5));
        dangChay--;
        if (dto.user_id === nguoi[7]) throw new Error('FCM hỏng');
        daBao.push(dto.user_id);
        return {};
      },
    } as unknown as Partial<NotificationsService>;

    const kq = await dichVu(thongBao).phatThongBaoHangMoi({
      seller_id: sellerId,
      seller_name: 'Shop A',
      product_id: 1,
      product_name: 'Ao moi',
      price: 150_000,
      currency: 'VND',
    });

    expect(caoNhat).toBeLessThanOrEqual(10);
    expect(daBao.sort((a, b) => a - b)).toEqual(
      nguoi.filter((id) => id !== nguoi[7]).sort((a, b) => a - b),
    );
    expect(kq).toEqual({ da_bao: 44, hong: 1 });
  });
});
