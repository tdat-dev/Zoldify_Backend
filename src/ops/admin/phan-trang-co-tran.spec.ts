import { FilesService } from '@catalog/files/files.service';
import { WithdrawalsService } from '@money/withdrawals/withdrawals.service';
import { AdminService } from '@ops/admin/admin.service';
import { MAX_PAGE_SIZE } from '@common/dto/pagination.dto';
import type { IUser } from '@identity/users/users.interface';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 3: năm danh sách còn `take: limit` thô.
 *
 * `findAll` của sản phẩm/đơn hàng đã đi qua `normalizePagination` từ lâu,
 * nhưng năm chỗ dưới đây vẫn tự tính `skip: (page - 1) * limit, take: limit`
 * từ con số controller đưa xuống (`+limit || 20`). Nên:
 *   · `?limit=1000000` nạp cả triệu dòng vào RAM (đúng lỗi từng treo /orders);
 *   · `?page=-5` ra `skip` âm, TypeORM ném và route trả 500.
 *
 * Không cần database: chỉ cần xem service đưa gì xuống `findAndCount`.
 */
type Goi = { skip?: number; take?: number };

function khoGia() {
  const goi: Goi[] = [];
  return {
    goi,
    repo: {
      findAndCount: jest.fn((o: Goi) => {
        goi.push(o);
        return Promise.resolve([[], 0]);
      }),
    },
  };
}

const admin = { id: 1, role: 'admin' } as IUser;

const truongHop: Array<{
  ten: string;
  goi: (page: number, limit: number) => Promise<unknown>;
  goiRepo: Goi[];
}> = [];

function dangKy() {
  const f = khoGia();
  const files = new FilesService(f.repo as never);
  truongHop.push({
    ten: 'FilesService.findAll',
    goi: (p, l) => files.findAll(p, l, undefined, admin),
    goiRepo: f.goi,
  });

  const w = khoGia();
  const rut = new WithdrawalsService(
    w.repo as never,
    {} as never,
    {} as never,
    {} as never,
  );
  truongHop.push({
    ten: 'WithdrawalsService.findByUser',
    goi: (p, l) => rut.findByUser(7, p, l),
    goiRepo: w.goi,
  });
  truongHop.push({
    ten: 'WithdrawalsService.findAll',
    goi: (p, l) => rut.findAll(p, l),
    goiRepo: w.goi,
  });

  const u = khoGia();
  const r = khoGia();
  const ad = new AdminService(
    u.repo as never,
    {} as never,
    {} as never,
    {} as never,
    r.repo as never,
    {} as never,
    {} as never,
    {} as never,
  );
  truongHop.push({
    ten: 'AdminService.getUsers',
    goi: (p, l) => ad.getUsers(p, l),
    goiRepo: u.goi,
  });
  truongHop.push({
    ten: 'AdminService.getWithdrawals',
    goi: (p, l) => ad.getWithdrawals(p, l),
    goiRepo: r.goi,
  });
}
dangKy();

describe.each(truongHop)('$ten: phân trang có trần', (tc) => {
  beforeEach(() => {
    tc.goiRepo.length = 0;
  });

  it(`limit khổng lồ bị ép về ${MAX_PAGE_SIZE}`, async () => {
    await tc.goi(1, 1_000_000);
    expect(tc.goiRepo[0].take).toBe(MAX_PAGE_SIZE);
  });

  it('page âm về trang 1 (skip 0), không ra skip âm', async () => {
    await tc.goi(-5, 20);
    expect(tc.goiRepo[0].skip).toBe(0);
  });

  it('page NaN về trang 1', async () => {
    await tc.goi(Number('abc'), 20);
    expect(tc.goiRepo[0].skip).toBe(0);
    expect(tc.goiRepo[0].take).toBe(20);
  });

  it('meta khớp với số thật sự dùng để truy vấn', async () => {
    const kq = (await tc.goi(-5, 1_000_000)) as {
      meta: { current: number; pageSize: number };
    };
    expect(kq.meta.current).toBe(1);
    expect(kq.meta.pageSize).toBe(MAX_PAGE_SIZE);
  });
});
