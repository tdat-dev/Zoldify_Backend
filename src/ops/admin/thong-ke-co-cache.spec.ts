import { createCache } from 'cache-manager';
import { AdminService } from './admin.service';
import { OrdersService } from '@ordering/orders/orders.service';

/**
 * Bảng điều khiển admin đếm CẢ BẢNG ở mỗi lần mở (rà soát "1 triệu dòng"
 * 28/10, mục 5).
 *
 * `AdminService.getDashboardStats` và `OrdersService.getStats` chạy
 * `COUNT(*)` trên users, products, orders cộng một SUM doanh thu, mỗi lần
 * gọi. InnoDB không giữ sẵn số dòng: một triệu đơn là đọc cả triệu mục index
 * mỗi lần admin bấm F5, và trang dashboard tự làm mới.
 *
 * Bài này đo: gọi hai lần liên tiếp thì database chỉ bị hỏi MỘT lượt.
 * Không cần database: chỉ đếm số lần service chạm repository.
 */
function repoDem() {
  const dem = { n: 0 };
  const qb = {
    select: () => qb,
    where: () => qb,
    andWhere: () => qb,
    getRawOne: () => {
      dem.n++;
      return Promise.resolve({ total: '1000' });
    },
  };
  const repo = {
    count: () => {
      dem.n++;
      return Promise.resolve(7);
    },
    createQueryBuilder: () => qb,
  };
  return { dem, repo };
}

// Tham số cache đứng cuối; ép kiểu để bài biên dịch được cả trước khi
// service nhận nó (đỏ vì hành vi, không vì TypeScript).
type Dung<T> = new (...a: unknown[]) => T;

describe('Thống kê dashboard có cache', () => {
  it('AdminService.getDashboardStats: hai lần gọi, một lượt hỏi DB', async () => {
    const u = repoDem();
    const o = repoDem();
    const p = repoDem();
    const svc = new (AdminService as unknown as Dung<AdminService>)(
      u.repo,
      o.repo,
      p.repo,
      {},
      {},
      {},
      {},
      {},
      createCache({ ttl: 60_000 }),
    );
    const a = await svc.getDashboardStats();
    const lan1 = u.dem.n + o.dem.n + p.dem.n;
    const b = await svc.getDashboardStats();
    expect(u.dem.n + o.dem.n + p.dem.n).toBe(lan1);
    expect(b).toEqual(a);
    expect(a.total_orders).toBe(7);
  });

  it('OrdersService.getStats: hai lần gọi, một lượt hỏi DB', async () => {
    const o = repoDem();
    const p = repoDem();
    const u = repoDem();
    const thamSo: unknown[] = new Array(15).fill({});
    thamSo[0] = o.repo;
    thamSo[5] = p.repo;
    thamSo[6] = u.repo;
    thamSo[14] = undefined; // productsService
    const svc = new (OrdersService as unknown as Dung<OrdersService>)(
      ...thamSo,
      createCache({ ttl: 60_000 }),
    );
    const a = await svc.getStats();
    const lan1 = u.dem.n + o.dem.n + p.dem.n;
    const b = await svc.getStats();
    expect(u.dem.n + o.dem.n + p.dem.n).toBe(lan1);
    expect(b).toEqual(a);
    expect(a.total_revenue).toBe(1000);
  });
});
