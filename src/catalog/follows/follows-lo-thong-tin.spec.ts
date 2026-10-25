import { DataSource } from 'typeorm';
import { Follow } from './entities/follow.entity';
import { FollowsService } from './follows.service';
import { User } from '@identity/users/entities/user.entity';

/**
 * GET /follows/:id/followers và /following là route CÔNG KHAI, mà trả nguyên
 * dòng `users` của từng người: email, số điện thoại, vai trò, token_version,
 * email_verified, is_locked, last_seen. Ai không đăng nhập cũng gom được email
 * và số điện thoại của mọi người theo dõi một shop lớn.
 *
 * Chạy trên MySQL thật vì cách vá là chọn cột trong câu truy vấn: repository
 * giả bỏ qua `select` nên không chứng minh được gì.
 *
 * Danh sách cột được phép lấy theo đúng thứ app đang đọc
 * (Zoldify_Mobile features/follows/api.ts, kiểu FollowedUser): id, full_name,
 * avatar, created_at.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

const COT_DUOC_PHEP = ['id', 'full_name', 'avatar', 'created_at'];

describe('Danh sách theo dõi công khai không lộ thông tin cá nhân', () => {
  let ds: DataSource;
  let service: FollowsService;
  const R = Math.floor(Math.random() * 100_000);
  const SHOP = 9_000_000 + R;
  const KHACH = 9_100_000 + R;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Follow, User],
      synchronize: true,
      logging: false,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    service = new FollowsService(ds.getRepository(Follow));

    const users = ds.getRepository(User);
    for (const id of [SHOP, KHACH]) {
      await users.save({
        id,
        full_name: `User ${id}`,
        email: `lo-${id}@test.local`,
        phone_number: '0901234567',
        password: 'hash-bi-mat',
        role: 'buyer',
      } as User);
    }
    await ds
      .getRepository(Follow)
      .save({ follower_id: KHACH, following_id: SHOP });
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(Follow).delete({ follower_id: KHACH });
      await ds.getRepository(User).delete([SHOP, KHACH]);
      await ds.destroy();
    }
  });

  it('followers chỉ có id, full_name, avatar, created_at', async () => {
    const { result } = await service.getFollowers(SHOP);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(KHACH);
    for (const k of Object.keys(result[0])) {
      expect(COT_DUOC_PHEP).toContain(k);
    }
  });

  it('following chỉ có id, full_name, avatar, created_at', async () => {
    const { result } = await service.getFollowing(KHACH);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(SHOP);
    for (const k of Object.keys(result[0])) {
      expect(COT_DUOC_PHEP).toContain(k);
    }
  });
});
