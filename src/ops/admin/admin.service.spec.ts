import { DataSource, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { Withdrawal } from '@money/withdrawals/entities/withdrawal.entity';
import { WithdrawalsService } from '@money/withdrawals/withdrawals.service';
import { AdminService } from './admin.service';
import { UpdateUserByAdminDto } from './dto/update-user-by-admin.dto';

/**
 * VÁ M-01 — `PATCH /admin/users/:id` ghi được bất kỳ cột nào.
 *
 * TEST NÀY ĐỎ TRƯỚC (vulnerability tồn tại), XANH SAU KHI VÁ.
 *
 * 4 ca phải đỏ trước khi vá:
 *   - gửi `{password:'abc'}` → phải bị từ chối, và `users.password` KHÔNG đổi
 *   - gửi `{role:'admin'}` → bị từ chối (đã có route riêng)
 *   - gửi `{token_version:999}` → bị từ chối
 *   - gửi `{full_name:'X'}` → thành công
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('AdminService.updateUser — chặn ghi cột nhạy cảm (M-01)', () => {
  let ds: DataSource;
  let userRepo: Repository<User>;
  let service: AdminService;

  const R = Math.floor(Math.random() * 100_000);
  const ID = {
    admin: 8_000_000 + R,
    target: 8_100_000 + R,
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User],
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
    userRepo = ds.getRepository(User);

    // Mock các dependency không cần cho updateUser — dùng `as Repository<...>`
    // thay vì `as any` để pass lint; các hàm này không bao giờ được gọi trong
    // bài kiểm này nên mock rỗng là đủ.
    const mockOrderRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: () => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      }),
    } as unknown as Repository<Order>;
    const mockProductRepo = {
      count: jest.fn().mockResolvedValue(0),
    } as unknown as Repository<Product>;
    const mockSettingRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({}),
    } as unknown as Repository<Setting>;
    const mockWithdrawalRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    } as unknown as Repository<Withdrawal>;
    const mockWithdrawalsService = {
      approve: jest.fn(),
      complete: jest.fn(),
      reject: jest.fn(),
    } as unknown as WithdrawalsService;

    service = new AdminService(
      userRepo,
      mockOrderRepo,
      mockProductRepo,
      mockSettingRepo,
      mockWithdrawalRepo,
      mockWithdrawalsService,
    );

    // Tạo admin và user mục tiêu
    await userRepo.save([
      {
        id: ID.admin,
        full_name: 'Admin',
        email: `admin${R}@t.local`,
        password: 'x',
        role: 'admin',
      },
      {
        id: ID.target,
        full_name: 'Target',
        email: `target${R}@t.local`,
        password: 'x',
        role: 'buyer',
      },
    ] as User[]);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    // Reset password của user mục tiêu về giá trị gốc
    await userRepo.update(ID.target, {
      password: 'x',
      role: 'buyer',
      token_version: 0,
    });
  });

  const getUser = async (id: number) => userRepo.findOne({ where: { id } });

  it('M01-1: từ chối ghi password — chuỗi thô không được lưu vào DB', async () => {
    const passCu = (await getUser(ID.target))!.password;

    // Gửi payload chứa password — ép kiểu cố tình vì đây chính là thứ bài kiểm
    // gác: "cột cấm phải bị từ chối". Ép kiểu ở đây là đúng.
    await expect(
      service.updateUser(ID.target, {
        password: 'abc',
      } as unknown as UpdateUserByAdminDto),
    ).rejects.toThrow();

    // Password trong DB phải KHÔNG đổi
    const user = await getUser(ID.target);
    expect(user!.password).toBe(passCu);
  });

  it('M01-2: từ chối ghi role — có route riêng changeUserRole', async () => {
    const roleCu = (await getUser(ID.target))!.role;

    await expect(
      service.updateUser(ID.target, {
        role: 'admin',
      } as unknown as UpdateUserByAdminDto),
    ).rejects.toThrow();

    const user = await getUser(ID.target);
    expect(user!.role).toBe(roleCu);
  });

  it('M01-3: từ chối ghi token_version — vô hiệu phiên', async () => {
    const tvCu = (await getUser(ID.target))!.token_version;

    await expect(
      service.updateUser(ID.target, {
        token_version: 999,
      } as unknown as UpdateUserByAdminDto),
    ).rejects.toThrow();

    const user = await getUser(ID.target);
    expect(user!.token_version).toBe(tvCu);
  });

  it('M01-4: CHO PHÉP ghi full_name — cột an toàn', async () => {
    const result = await service.updateUser(ID.target, { full_name: 'X' });
    expect(result.full_name).toBe('X');
  });
});
