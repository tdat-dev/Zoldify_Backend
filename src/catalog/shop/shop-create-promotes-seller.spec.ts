import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { IUser } from '@identity/users/users.interface';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Shop } from './entities/shop.entity';
import { ShopService } from './shop.service';

/**
 * MỞ SHOP THÌ THÀNH NGƯỜI BÁN (issue #41).
 *
 * Đo trên staging 12/11: tài khoản `buyer` gọi POST /shop được 201, nhưng
 * profile, DB và cả lần đăng nhập lại vẫn ra `role: buyer`. Server không cần
 * vai trò để bán (đăng tin, nhận đơn đi theo việc CÓ shop), nhưng app dựa vào
 * `user.role` để hiện khu Người bán, nên người bán mới trên app không thấy khu
 * bán dù shop đã mở.
 *
 * Bất biến cần giữ: chỉ NÂNG `buyer` lên `seller`. Admin hay moderator tự mở
 * shop thì không được bị hạ quyền, nên điều kiện cập nhật phải ghim `role =
 * buyer` ngay trong câu UPDATE chứ không đọc rồi ghi (đọc rồi ghi để lọt khe
 * admin vừa đổi vai trò ở giữa hai câu).
 */
describe('Mở shop nâng buyer lên seller', () => {
  function buildService(opts: {
    myShop?: Partial<Shop> | null;
    slugTaken?: boolean;
  }) {
    const userUpdates: Array<{ where: unknown; set: unknown }> = [];
    const shopRepo = {
      findOne: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          'slug' in where
            ? opts.slugTaken
              ? { id: 99 }
              : null
            : (opts.myShop ?? null),
        ),
      create: (s: Partial<Shop>) => s,
      save: (s: Partial<Shop>) => Promise.resolve({ id: 1, ...s }),
    } as unknown as Repository<Shop>;
    const userRepo = {
      update: (where: unknown, set: unknown) => {
        userUpdates.push({ where, set });
        return Promise.resolve({ affected: 1 });
      },
    } as unknown as Repository<User>;
    const service = new ShopService(
      shopRepo,
      userRepo,
      {} as Repository<Product>,
      {} as Repository<Follow>,
      {} as Repository<OrderItem>,
    );
    return { service, userUpdates };
  }

  it('người mua mở shop thì vai trò thành seller', async () => {
    const { service, userUpdates } = buildService({ myShop: null });
    await service.create({ name: 'Shop mới', slug: 'shop-moi-21' }, {
      id: 21,
      role: 'buyer',
    } as IUser);
    expect(userUpdates).toEqual([
      {
        where: { id: 21, role: UserRole.BUYER },
        set: { role: UserRole.SELLER },
      },
    ]);
  });

  it('câu nâng vai trò chỉ nhắm vào dòng đang là buyer, admin mở shop không bị hạ', async () => {
    const { service, userUpdates } = buildService({ myShop: null });
    await service.create({ name: 'Shop admin', slug: 'shop-admin-3' }, {
      id: 3,
      role: 'admin',
    } as IUser);
    // Không dựa vào role trong token (có thể đã cũ): điều kiện nằm trong UPDATE.
    for (const c of userUpdates) {
      expect(c.where).toMatchObject({ role: UserRole.BUYER });
    }
  });

  it('mở shop hỏng (trùng slug hoặc đã có shop) thì không đụng vai trò', async () => {
    const taken = buildService({ myShop: null, slugTaken: true });
    await expect(
      taken.service.create({ name: 'X', slug: 'da-co' }, {
        id: 21,
        role: 'buyer',
      } as IUser),
    ).rejects.toThrow(BadRequestException);
    expect(taken.userUpdates).toHaveLength(0);

    const hasShop = buildService({ myShop: { id: 5 } });
    await expect(
      hasShop.service.create({ name: 'Y', slug: 'y' }, {
        id: 21,
        role: 'buyer',
      } as IUser),
    ).rejects.toThrow(BadRequestException);
    expect(hasShop.userUpdates).toHaveLength(0);
  });
});
