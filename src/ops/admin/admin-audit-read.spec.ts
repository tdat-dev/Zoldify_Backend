import { DataSource, Repository } from 'typeorm';
import { AdminActionLog } from './entities/admin-action-log.entity';
import { AdminAuditService } from './admin-audit.service';

/**
 * ĐỌC NHẬT KÝ HÀNH ĐỘNG ADMIN (task #34, phần sau).
 *
 * Một nhật ký chỉ tra được bằng `mysql -e "SELECT ..."` thì trên thực tế là
 * không ai tra. Câu hỏi mà bảng này sinh ra để trả lời — *ai đã khoá tài khoản
 * này, lúc nào* — phải hỏi được từ trang quản trị, nếu không thì lúc có sự cố
 * người ta vẫn đi hỏi nhau trong nhóm chat như trước.
 *
 * Hai bộ lọc dưới đây không phải cho đẹp: chúng là đúng hai câu hỏi mà hai
 * index ghép của bảng được dựng để phục vụ (xem `admin-action-log.entity.ts`).
 * Thêm bộ lọc thứ ba mà không thêm index là mời một lần quét toàn bảng.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('AdminAuditService — đọc nhật ký', () => {
  let dataSource: DataSource;
  let repo: Repository<AdminActionLog>;
  let service: AdminAuditService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [AdminActionLog],
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
    repo = dataSource.getRepository(AdminActionLog);
    service = new AdminAuditService(repo);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await repo.clear();
    await repo.save([
      repo.create({
        admin_id: 1,
        method: 'PATCH',
        path: '/admin/users/9/toggle-lock',
        action: 'admin.users.toggle-lock',
        target_type: 'users',
        target_id: '9',
      }),
      repo.create({
        admin_id: 2,
        method: 'DELETE',
        path: '/admin/users/9',
        action: 'admin.users',
        target_type: 'users',
        target_id: '9',
      }),
      repo.create({
        admin_id: 1,
        method: 'PATCH',
        path: '/admin/settings',
        action: 'admin.settings',
        target_type: 'settings',
        target_id: null,
      }),
    ]);
  });

  it('trả mới nhất trước — người tra cần việc vừa xảy ra, không phải việc năm ngoái', async () => {
    const { result } = await service.tra({ page: 1, limit: 10 });
    expect(result).toHaveLength(3);
    // save() ghi theo thứ tự nên id tăng dần; mới nhất = id lớn nhất.
    expect(result[0].id).toBeGreaterThan(result[2].id);
  });

  it('lọc theo đối tượng — "ai đã đụng vào người dùng số 9"', async () => {
    const { result, meta } = await service.tra({
      page: 1,
      limit: 10,
      target_type: 'users',
      target_id: '9',
    });
    expect(meta.total).toBe(2);
    expect(result.every((r) => r.target_id === '9')).toBe(true);
  });

  it('lọc theo admin — "admin số 1 đã làm những gì"', async () => {
    const { meta } = await service.tra({ page: 1, limit: 10, admin_id: 1 });
    expect(meta.total).toBe(2);
  });

  it('phân trang có chặn trần — limit khổng lồ không kéo cả bảng về', async () => {
    // Cùng lý do với Epic 3 (chặn limit toàn hệ): một `?limit=1000000` từ trang
    // quản trị là đủ để dựng 1 triệu entity trong RAM của tiến trình api, và
    // Node chỉ có một luồng nên mọi người khác xếp hàng sau nó.
    const { meta } = await service.tra({ page: 1, limit: 1_000_000 });
    expect(meta.pageSize).toBeLessThanOrEqual(100);
  });
});
