import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { IUser } from '@identity/users/users.interface';
import { User } from '@identity/users/entities/user.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Shop } from './entities/shop.entity';
import { ShopService } from './shop.service';

/**
 * SHOP NGƯỜI BÁN — module này trước hôm nay không có bài kiểm nào.
 *
 * Hai nhóm bất biến, và nhóm thứ hai mới là nhóm đáng lo:
 *
 *   1. Mỗi người một shop, mỗi slug một chủ. Slug nằm trên URL công khai
 *      (`/shop/<slug>`), nên hai shop cùng slug là hai người tranh nhau một
 *      địa chỉ.
 *
 *   2. **Trang shop công khai chỉ được hiện hàng ĐANG MỞ BÁN.** Đây đúng loại
 *      lỗi mà `2752f41` đã phải vá một lần ở danh sách sản phẩm công khai:
 *      thiếu lọc `status` thì hàng bị từ chối, hàng nháp, hàng đang chờ duyệt
 *      nằm chung với hàng thật. Ở đây nó xuất hiện ở HAI chỗ — `getShopInfo`
 *      đếm số sản phẩm, và `getShopProducts` liệt kê — nên kiểm cả hai.
 *
 * Dùng repository giả: cả hai bất biến nằm trong mã (điều kiện `where`), không
 * trong ràng buộc database. Cùng quy tắc đã ghi ở `follows.service.spec.ts`.
 */
describe('ShopService', () => {
  const nguoiBan: IUser = { id: 7, role: 'seller' } as IUser;

  function dungService(opts: {
    shopCuaToi?: Partial<Shop> | null;
    shopTrungSlug?: Partial<Shop> | null;
    nguoiDung?: Partial<User> | null;
  }) {
    const daLuu: Array<Partial<Shop>> = [];
    const dieuKienDem: Array<Record<string, unknown>> = [];
    const dieuKienTim: Array<Record<string, unknown>> = [];

    const shopRepo = {
      findOne: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'slug' in where
            ? (opts.shopTrungSlug ?? null)
            : (opts.shopCuaToi ?? null),
        ),
      create: (s: Partial<Shop>) => s,
      save: (s: Partial<Shop>) => {
        daLuu.push(s);
        return Promise.resolve(s);
      },
      update: () => Promise.resolve({ affected: 1 }),
    } as unknown as Repository<Shop>;

    const productRepo = {
      count: ({ where }: { where: Record<string, unknown> }) => {
        dieuKienDem.push(where);
        return Promise.resolve(3);
      },
      findAndCount: ({ where }: { where: Record<string, unknown> }) => {
        dieuKienTim.push(where);
        return Promise.resolve([[], 0]);
      },
    } as unknown as Repository<Product>;

    const service = new ShopService(
      shopRepo,
      {
        findOne: () => Promise.resolve(opts.nguoiDung ?? null),
      } as unknown as Repository<User>,
      productRepo,
      { count: () => Promise.resolve(5) } as unknown as Repository<Follow>,
      {} as Repository<OrderItem>,
    );

    return { service, daLuu, dieuKienDem, dieuKienTim };
  }

  // ── Một người một shop ───────────────────────────────────────────────────
  it('đã có shop thì không tạo thêm được', async () => {
    const { service, daLuu } = dungService({ shopCuaToi: { id: 1 } });

    await expect(
      service.create({ name: 'Shop 2', slug: 'shop-2' }, nguoiBan),
    ).rejects.toThrow(BadRequestException);
    expect(daLuu).toHaveLength(0);
  });

  it('slug đã có chủ thì không tạo được', async () => {
    // Slug nằm trên URL công khai. Hai shop cùng slug là hai người tranh nhau
    // một địa chỉ, và ai thắng là tuỳ thứ tự MySQL trả về.
    const { service, daLuu } = dungService({
      shopCuaToi: null,
      shopTrungSlug: { id: 9 },
    });

    await expect(
      service.create({ name: 'Shop', slug: 'da-co-chu' }, nguoiBan),
    ).rejects.toThrow(BadRequestException);
    expect(daLuu).toHaveLength(0);
  });

  it('chưa có shop và slug trống thì tạo được', async () => {
    const { service, daLuu } = dungService({
      shopCuaToi: null,
      shopTrungSlug: null,
    });

    await service.create({ name: 'Shop', slug: 'shop-moi' }, nguoiBan);
    expect(daLuu).toHaveLength(1);
    expect(daLuu[0].user).toEqual({ id: nguoiBan.id });
  });

  it('chưa có shop thì getMyShop báo NotFound', async () => {
    const { service } = dungService({ shopCuaToi: null });
    await expect(service.getMyShop(nguoiBan)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── Chỉ hiện hàng đang mở bán ────────────────────────────────────────────
  it('getShopProducts CHỈ liệt kê hàng ACTIVE', async () => {
    // Cùng loại lỗi mà 2752f41 đã vá ở danh sách sản phẩm công khai: thiếu lọc
    // `status` thì hàng bị từ chối và hàng nháp nằm chung với hàng thật, ngay
    // trên trang shop mà khách vào xem.
    const { service, dieuKienTim } = dungService({});

    await service.getShopProducts(7, 1, 20);

    expect(dieuKienTim[0]).toMatchObject({
      seller: { id: 7 },
      status: ProductStatus.ACTIVE,
    });
  });

  it('getShopInfo CHỈ đếm hàng ACTIVE', async () => {
    // Con số này hiện trên trang shop. Đếm cả hàng nháp là nói với khách rằng
    // shop có nhiều hàng hơn thực tế.
    const { service, dieuKienDem } = dungService({ shopCuaToi: { id: 1 } });

    await service.getShopInfo(7);

    expect(dieuKienDem[0]).toMatchObject({
      seller: { id: 7 },
      status: ProductStatus.ACTIVE,
    });
  });

  // ── Người bán chưa lập shop ──────────────────────────────────────────────
  it('chưa lập shop thì getShopInfo vẫn trả tên và ảnh từ tài khoản', async () => {
    // Người bán đăng hàng được trước khi lập shop, nên trang shop phải hiện
    // được thứ gì đó thay vì 404 — nếu không thì sản phẩm của họ dẫn tới một
    // trang chết.
    const { service } = dungService({
      shopCuaToi: null,
      nguoiDung: { id: 7, full_name: 'Nguyen Van A', avatar: 'a.png' },
    });

    const info = await service.getShopInfo(7);
    expect(info).toMatchObject({
      name: 'Nguyen Van A',
      logo: 'a.png',
      productCount: 3,
      followerCount: 5,
    });
  });

  it('không có cả shop lẫn tài khoản thì báo lỗi', async () => {
    const { service } = dungService({ shopCuaToi: null, nguoiDung: null });
    await expect(service.getShopInfo(999)).rejects.toThrow(BadRequestException);
  });
});
