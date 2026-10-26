import type { IUser } from '@identity/users/users.interface';
import { ShopService } from './shop.service';

/**
 * Trang shop công khai và danh sách đơn của người bán lộ thông tin cá nhân.
 *
 *   1. GET /shop/:sellerId (@Public) trả nguyên dòng `shops` kèm
 *      `relations: ['user']`: các cột pickup_* là ĐỊA CHỈ NHÀ người bán (sàn
 *      C2C, mỗi người gửi hàng từ nhà mình), cộng nguyên dòng users của họ
 *      (email, số điện thoại, vai trò, token_version). Chủ shop đọc pickup_*
 *      qua GET /shop/me; web và app không đọc pickup_* từ route công khai.
 *   2. GET /shop/:sellerId/orders trả `order.user` là nguyên dòng users của
 *      NGƯỜI MUA cho người bán. orders.findOne đã cắt còn { id, full_name } vì
 *      người bán chỉ cần receiver_* trên đơn; route này sót.
 *   3. `limit` không có trần: ?limit=1000000 là nạp cả bảng; page âm cho skip
 *      âm.
 *
 * Repository giả là đủ ở đây vì cách vá là LỌC ở mã (danh sách trắng), không
 * dựa vào SELECT: repo trả về dòng đầy đủ như thể đã nạp quan hệ.
 */
const NGUOI_DAY_DU = {
  id: 7,
  full_name: 'Người bán',
  avatar: 'a.png',
  created_at: new Date('2026-01-01'),
  email: 'nguoi-ban@gmail.com',
  phone_number: '0901234567',
  role: 'seller',
  token_version: 3,
  is_locked: false,
};

function dung() {
  const shop = {
    id: 1,
    name: 'Shop A',
    slug: 'shop-a',
    description: 'mô tả',
    logo: 'logo.png',
    banner: 'banner.png',
    user: NGUOI_DAY_DU,
    pickup_name: 'Nguyễn Văn A',
    pickup_phone: '0901234567',
    pickup_address: '12 Ngõ 34, nhà riêng',
    pickup_province_name: 'Hà Nội',
    pickup_district_id: 1485,
    pickup_district_name: 'Cầu Giấy',
    pickup_ward_code: '1A0101',
    pickup_ward_name: 'Dịch Vọng',
  };
  const timSanPham: Array<{ skip: number; take: number }> = [];
  const timDon: Array<{ skip: number; take: number }> = [];
  const buyer = { ...NGUOI_DAY_DU, id: 2, email: 'nguoi-mua@gmail.com' };
  const service = new ShopService(
    { findOne: () => Promise.resolve(shop) } as never,
    { findOne: () => Promise.resolve(null) } as never,
    {
      count: () => Promise.resolve(3),
      findAndCount: (o: { skip: number; take: number }) => {
        timSanPham.push(o);
        return Promise.resolve([[], 0]);
      },
    } as never,
    { count: () => Promise.resolve(5) } as never,
    {
      findAndCount: (o: { skip: number; take: number }) => {
        timDon.push(o);
        return Promise.resolve([
          [{ id: 11, order: { id: 100, user: buyer }, product: { id: 5 } }],
          1,
        ]);
      },
    } as never,
  );
  return { service, timSanPham, timDon };
}

const chuShop = { id: 7, role: 'seller' } as IUser;

describe('Shop công khai không lộ địa chỉ nhà và hồ sơ tài khoản', () => {
  it('GET /shop/:sellerId không trả pickup_*', async () => {
    const { service } = dung();
    const info = JSON.parse(
      JSON.stringify(await service.getShopInfo(7)),
    ) as Record<string, unknown>;

    const lo = Object.keys(info).filter((k) => k.startsWith('pickup_'));
    expect(lo).toEqual([]);
    expect(info.name).toBe('Shop A');
  });

  it('GET /shop/:sellerId chỉ trả id, full_name, avatar, created_at của chủ shop', async () => {
    const { service } = dung();
    const info = JSON.parse(JSON.stringify(await service.getShopInfo(7))) as {
      user: Record<string, unknown>;
    };

    expect(Object.keys(info.user).sort()).toEqual(
      ['avatar', 'created_at', 'full_name', 'id'].sort(),
    );
  });

  it('đơn của người bán chỉ kèm id và full_name người mua', async () => {
    const { service } = dung();
    const res = JSON.parse(
      JSON.stringify(
        await service.getSellerOrders(7, 1, 20, undefined, chuShop),
      ),
    ) as { result: Array<{ user: Record<string, unknown> }> };

    expect(Object.keys(res.result[0].user).sort()).toEqual(['full_name', 'id']);
  });
});

describe('Phân trang của shop có trần', () => {
  it('getShopProducts: limit tối đa 100, page âm về trang 1', async () => {
    const { service, timSanPham } = dung();
    await service.getShopProducts(7, -3, 1_000_000);

    expect(timSanPham[0].take).toBeLessThanOrEqual(100);
    expect(timSanPham[0].skip).toBeGreaterThanOrEqual(0);
  });

  it('getSellerOrders: limit tối đa 100, page âm về trang 1', async () => {
    const { service, timDon } = dung();
    await service.getSellerOrders(7, -3, 1_000_000, undefined, chuShop);

    expect(timDon[0].take).toBeLessThanOrEqual(100);
    expect(timDon[0].skip).toBeGreaterThanOrEqual(0);
  });
});
