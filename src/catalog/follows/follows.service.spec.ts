import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Follow } from './entities/follow.entity';
import { FollowsService } from './follows.service';
import { User } from '@identity/users/entities/user.entity';

/**
 * THEO DÕI NGƯỜI BÁN — module này trước hôm nay không có bài kiểm nào.
 *
 * Bất biến thật nằm ở **database** (khoá `UNIQUE(follower_id, following_id)`),
 * nên bài kiểm phải chạy trên MySQL thật — mock đi thì xanh mà không chứng minh gì.
 *
 * Khoá đó **đã có sẵn** ở `src/migrations/1690000000000-InitialSchema.ts:70` và
 * `@Unique` trong `follow.entity.ts`. B5-2 **không có việc sửa mã** — chỉ có
 * việc viết bài kiểm.
 *
 * Ca đua dùng `Promise.allSettled`: hai `toggle` **song song**, đúng một
 * `rejected`, đúng một `fulfilled`, và sau đó bảng còn **một** dòng.
 * Giải thích vì sao gọi tuần tự thì không kiểm được gì (lần hai `toggle`
 * **xoá** dòng rồi trả về, nó không ném).
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('FollowsService', () => {
  let dataSource: DataSource;
  let service: FollowsService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Follow, User],
      synchronize: true,
      logging: false,
    });
    try {
      await dataSource.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    service = new FollowsService(dataSource.getRepository(Follow));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(Follow).clear();
  });

  const taoUser = async (id: number) => {
    const userRepo = dataSource.getRepository(User);
    await userRepo.save({
      id,
      full_name: `User ${id}`,
      email: `user${id}@test.local`,
      password: 'x',
      role: 'buyer',
    } as User);
  };

  it('không cho theo dõi chính mình', async () => {
    // Không phải chuyện thẩm mỹ: một dòng tự-theo-dõi làm `countFollowers`
    // đếm thêm một người không có thật, và con số đó hiện trên trang shop.
    await taoUser(7);
    await expect(service.toggle(7, 7)).rejects.toThrow(BadRequestException);
  });

  it('bấm lần đầu là theo dõi, lần hai là bỏ theo dõi', async () => {
    await taoUser(1);
    await taoUser(2);
    const lan1 = await service.toggle(1, 2);
    expect(lan1.followed).toBe(true);

    const lan2 = await service.toggle(1, 2);
    expect(lan2.followed).toBe(false);

    // Lần ba phải theo dõi lại được — nếu `remove` xoá nhầm nhiều dòng hoặc
    // `findOne` so sai chiều thì ca này mới lộ.
    const lan3 = await service.toggle(1, 2);
    expect(lan3.followed).toBe(true);
  });

  it('theo dõi có CHIỀU: A theo B không có nghĩa B theo A', async () => {
    // `findOne` so cả hai cột. Đảo nhầm chiều thì bấm theo dõi một người sẽ
    // vô tình bỏ theo dõi người đang theo mình — lỗi im lặng, không ai báo.
    await taoUser(1);
    await taoUser(2);
    await service.toggle(1, 2);

    expect(await service.isFollowing(1, 2)).toBe(true);
    expect(await service.isFollowing(2, 1)).toBe(false);
  });

  it('đếm đúng hai chiều', async () => {
    await taoUser(1);
    await taoUser(2);
    await taoUser(10);
    await taoUser(3);
    await service.toggle(1, 10);
    await service.toggle(2, 10);
    await service.toggle(10, 3);

    expect(await service.countFollowers(10)).toBe(2);
    expect(await service.countFollowings(10)).toBe(1);
  });

  it('hai request song song tạo trùng → database từ chối (khoá UNIQUE)', async () => {
    // Khoá UNIQUE(follower_id, following_id) đã có trong migration
    // InitialSchema (line 70). Database phải từ chối lần ghi thứ hai.
    await taoUser(1);
    await taoUser(2);

    // Xoá nếu có để đảm bảo trạng thái sạch
    await dataSource
      .getRepository(Follow)
      .delete({ follower_id: 1, following_id: 2 });

    // Hai request song song cùng tạo follow → một sẽ bị DB từ chối do UNIQUE
    const results = await Promise.allSettled([
      service.toggle(1, 2),
      service.toggle(1, 2),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(Error);
  });
});
