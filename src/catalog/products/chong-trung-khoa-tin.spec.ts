import { ConflictException, BadRequestException } from '@nestjs/common';
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
 * Chống đăng trùng, khôi phục tin đã xoá, khoá tin sau khi đăng: bài kiểm viết TRƯỚC.
 *
 * VÌ SAO CHỈ CHẶN TRONG CÙNG NGƯỜI BÁN. Hai người cùng bán một model là chuyện
 * bình thường của chợ đồ cũ. Trùng có hại là một người đăng đi đăng lại để chiếm
 * chỗ, và URL gần giống nhau làm loãng nhau trên Google.
 *
 * VÌ SAO TÍNH CẢ TIN ĐÃ XOÁ. Không tính thì người bán xoá rồi đăng lại là né được.
 * Tin đã xoá có sẵn lịch sử và URL, nên đưa người bán về nút khôi phục.
 *
 * VÌ SAO HẾT HÀNG THÌ ĐƯỢC ĐĂNG. Bán hết một món rồi có món khác cùng tên là việc
 * thật của người bán đồ cũ.
 *
 * VÌ SAO KHOÁ DANH MỤC VÀ SLUG. URL đã vào Google phải giữ nghĩa cũ. Sửa một tin
 * điện thoại thành quần áo là mượn thứ hạng của tin cũ cho món khác.
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

describe('ProductsService: chống trùng và khoá tin', () => {
  let ds: DataSource;
  let svc: ProductsService;
  let a: IUser;
  let b: IUser;
  let admin: IUser;
  let cat1: number;
  let cat2: number;
  let dem = 0;

  const ten = () => `Mon trung ${++dem}`;
  const dang = (u: IUser, name: string, them: Record<string, unknown> = {}) =>
    svc.create(
      {
        name,
        price: 100_000,
        category_id: cat1,
        stock: 1,
        ...them,
      } as CreateProductDto,
      u,
    );

  const tao = async (email: string, role: UserRole, shop: boolean) => {
    const r = await ds.query<{ insertId: number }>(
      "INSERT INTO users (full_name, email, password, role) VALUES ('N', ?, 'x', ?)",
      [email, role],
    );
    if (shop) {
      await ds.query(
        `INSERT INTO shops (name, slug, status, user_id, pickup_name, pickup_phone,
           pickup_address, pickup_province_name, pickup_district_name, pickup_ward_name)
         VALUES ('s', ?, 'active', ?, 'N', '0900000000', 'So 1', 'Ha Noi', 'Cau Giay', 'P')`,
        [`shop-${email}`, r.insertId],
      );
    }
    return { id: r.insertId, email, full_name: 'N', role } as unknown as IUser;
  };

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

    a = await tao('a@t.local', UserRole.SELLER, true);
    b = await tao('b@t.local', UserRole.SELLER, true);
    admin = await tao('ad@t.local', UserRole.ADMIN, false);
    const c1 = await ds.query<{ insertId: number }>(
      "INSERT INTO categories (name, slug, is_active) VALUES ('C1','c1-ct',1)",
    );
    const c2 = await ds.query<{ insertId: number }>(
      "INSERT INTO categories (name, slug, is_active) VALUES ('C2','c2-ct',1)",
    );
    cat1 = c1.insertId;
    cat2 = c2.insertId;

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

  const loi = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      return e as ConflictException;
    }
    throw new Error('Đáng lẽ phải lỗi');
  };

  it('cùng người bán đăng trùng tin đang bán: 409 kèm id tin cũ', async () => {
    const n = ten();
    const cu = await dang(a, n);
    const e = await loi(() => dang(a, n));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse()).toMatchObject({
      existing_product_id: cu.id,
      da_xoa: false,
    });
  });

  it('khác hoa thường, thừa khoảng trắng vẫn tính là trùng', async () => {
    const n = ten();
    await dang(a, n);
    const e = await loi(() => dang(a, `  ${n.toUpperCase()}  `));
    expect(e).toBeInstanceOf(ConflictException);
  });

  it('trùng tin đã xoá: 409 báo da_xoa để đưa về nút khôi phục', async () => {
    const n = ten();
    const cu = await dang(a, n);
    await svc.remove(cu.id, a);
    const e = await loi(() => dang(a, n));
    expect(e.getResponse()).toMatchObject({
      existing_product_id: cu.id,
      da_xoa: true,
    });
  });

  it('tin cũ đã hết hàng thì được đăng món mới cùng tên', async () => {
    const n = ten();
    const cu = await dang(a, n);
    await ds.query('UPDATE products SET stock = 0 WHERE id = ?', [cu.id]);
    const moi = await dang(a, n);
    expect(moi.id).not.toBe(cu.id);
  });

  it('hai người bán cùng tên cùng slug đều đăng được', async () => {
    const n = ten();
    const slug = `slug-chung-${dem}`;
    const p1 = await dang(a, n, { slug });
    const p2 = await dang(b, n, { slug });
    expect(p2.id).not.toBe(p1.id);
    expect(p2.slug).not.toBe(p1.slug);
    expect(p2.slug.startsWith(slug)).toBe(true);
  });

  it('khôi phục tin đã xoá: chủ tin làm được, tin hiện lại', async () => {
    const cu = await dang(a, ten());
    await svc.remove(cu.id, a);
    const lai = await svc.restore(cu.id, a);
    expect(lai.id).toBe(cu.id);
    expect((await svc.findOne(cu.id)).id).toBe(cu.id);
  });

  it('người khác không khôi phục được tin của mình', async () => {
    const cu = await dang(a, ten());
    await svc.remove(cu.id, a);
    await expect(svc.restore(cu.id, b)).rejects.toThrow();
    await expect(svc.findOne(cu.id)).rejects.toThrow();
  });

  it('khôi phục tin chưa xoá: 404', async () => {
    const cu = await dang(a, ten());
    await expect(svc.restore(cu.id, a)).rejects.toThrow();
  });

  it('sửa tin không đổi được slug', async () => {
    const cu = await dang(a, ten(), { slug: `giu-slug-${dem}` });
    const sua = await svc.update(cu.id, { slug: 'slug-khac' }, a);
    expect(sua.slug).toBe(cu.slug);
  });

  it('người bán không đổi được danh mục sau khi đăng', async () => {
    const cu = await dang(a, ten());
    const e = await loi(() => svc.update(cu.id, { category_id: cat2 }, a));
    expect(e).toBeInstanceOf(BadRequestException);
  });

  it('form gửi lại đúng danh mục cũ thì vẫn lưu được', async () => {
    const cu = await dang(a, ten());
    const sua = await svc.update(
      cu.id,
      { category_id: cat1, price: 200_000 },
      a,
    );
    expect(Number(sua.price)).toBe(200_000);
  });

  it('admin vẫn sửa được danh mục khi người bán chọn nhầm', async () => {
    const cu = await dang(a, ten());
    const sua = await svc.update(cu.id, { category_id: cat2 }, admin);
    expect(sua.category.id).toBe(cat2);
  });
});
