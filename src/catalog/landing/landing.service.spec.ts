import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { LandingService } from './landing.service';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { User } from '@identity/users/entities/user.entity';

/**
 * Trang đích theo hãng, tầm giá, địa điểm: bài kiểm viết TRƯỚC.
 *
 * VÌ SAO CÓ CỔNG CHẤT LƯỢNG. Mở trang cho mọi tổ hợp là tự tạo hàng nghìn trang
 * mỏng, thứ Google coi là rác và kéo cả site xuống. Nên một trang chỉ mở khi:
 *
 *   1. Có từ 5 tin thật trở lên.
 *   2. Là tập con THẬT SỰ của danh mục. Đo trên prod 07/11: mọi tin thật đều ở một
 *      tỉnh, nên trang "điện thoại tại Hồ Chí Minh" sẽ trùng hệt trang danh mục.
 *
 * Tin thật là tin có `province_slug`: dữ liệu thử sp-1m-* để trống cột này.
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

describe('LandingService', () => {
  let ds: DataSource;
  let svc: LandingService;
  let seller: number;
  let cat: number;
  let dem = 0;

  const them = async (o: {
    brand?: string | null;
    price?: number;
    tinh?: string | null;
    stock?: number;
    status?: string;
    catId?: number;
  }) => {
    dem += 1;
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, seller_id, category_id, status,
         brand, province_name, province_slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `Mon ${dem}`,
        `mon-ld-${dem}`,
        o.price ?? 500_000,
        o.stock ?? 1,
        seller,
        o.catId ?? cat,
        o.status ?? 'active',
        o.brand ?? null,
        o.tinh === null ? null : (o.tinh ?? 'Hà Nội'),
        o.tinh === null ? null : o.tinh ? 'da-nang' : 'ha-noi',
      ],
    );
  };
  const nhieu = async (n: number, o: Parameters<typeof them>[0]) => {
    for (let i = 0; i < n; i++) await them(o);
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Product, Category, Shop, User],
      synchronize: true,
    });
    await ds.initialize();
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['products', 'shops', 'categories', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');
    const u = await ds.query<{ insertId: number }>(
      "INSERT INTO users (full_name, email, password, role) VALUES ('B','l@t.local','x','seller')",
    );
    seller = u.insertId;
    const c = await ds.query<{ insertId: number }>(
      "INSERT INTO categories (name, slug, is_active) VALUES ('Điện thoại','dien-thoai-ld',1)",
    );
    cat = c.insertId;

    await nhieu(6, { brand: 'Apple', price: 8_000_000 }); // đủ cổng
    await nhieu(4, { brand: 'Nokia', price: 500_000 }); // thiếu 1 tin
    await nhieu(5, { brand: 'Samsung', price: 500_000, tinh: 'Đà Nẵng' });
    // Không được tính vào đâu cả:
    await nhieu(9, { brand: 'Nokia', tinh: null }); // dữ liệu thử
    await nhieu(9, { brand: 'Nokia', stock: 0 }); // hết hàng
    await nhieu(9, { brand: 'Nokia', status: 'sold' });

    svc = new LandingService(
      ds.getRepository(Product),
      ds.getRepository(Category),
      createCache(),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  const facet = async (slug: string) =>
    (await svc.boLoc('dien-thoai-ld')).facets.find((f) => f.slug === slug);

  it('chỉ đếm tin thật còn hàng', async () => {
    expect((await svc.boLoc('dien-thoai-ld')).total).toBe(15);
  });

  it('hãng đủ 5 tin thì có trang, gom theo slug', async () => {
    expect(await facet('apple')).toMatchObject({
      type: 'brand',
      label: 'Apple',
      count: 6,
    });
  });

  it('hãng thiếu tin thì không có trang, tin thử và hết hàng không được bù vào', async () => {
    expect(await facet('nokia')).toBeUndefined();
    await expect(svc.trang('dien-thoai-ld', 'nokia')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tầm giá đủ tin thì có trang', async () => {
    expect(await facet('gia-5-den-10-trieu')).toMatchObject({
      type: 'price',
      count: 6,
    });
  });

  it('địa điểm có trang khi là tập con của danh mục', async () => {
    expect(await facet('tai-ha-noi')).toMatchObject({
      type: 'location',
      label: 'Hà Nội',
      count: 10,
    });
    expect(await facet('tai-da-nang')).toMatchObject({ count: 5 });
  });

  it('bộ lọc phủ cả danh mục thì không có trang: nó trùng trang danh mục', async () => {
    const c = await ds.query<{ insertId: number }>(
      "INSERT INTO categories (name, slug, is_active) VALUES ('Mot tinh','mot-tinh-ld',1)",
    );
    await nhieu(6, { brand: 'Sony', catId: c.insertId });
    const r = await new LandingService(
      ds.getRepository(Product),
      ds.getRepository(Category),
      createCache(),
    ).boLoc('mot-tinh-ld');
    expect(r.total).toBe(6);
    expect(r.facets).toEqual([]);
  });

  it('trang đích trả tin, tổng và khoảng giá thật', async () => {
    const t = await svc.trang('dien-thoai-ld', 'apple');
    expect(t.total).toBe(6);
    expect(t.items).toHaveLength(6);
    expect(t.price_min).toBe(8_000_000);
    expect(t.price_max).toBe(8_000_000);
    expect(t.items[0]).toHaveProperty('slug');
    expect(t.category.slug).toBe('dien-thoai-ld');
  });

  it('danh mục hoặc bộ lọc không có thật: 404', async () => {
    await expect(svc.boLoc('khong-co')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.trang('dien-thoai-ld', 'bua-bai')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('liệt kê đường dẫn cho sitemap', async () => {
    const ds2 = await svc.duongDan();
    expect(ds2).toContain('/category/dien-thoai-ld/apple');
    expect(ds2).toContain('/category/dien-thoai-ld/tai-ha-noi');
    expect(ds2.some((d) => d.endsWith('/nokia'))).toBe(false);
  });
});
