import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { AdminService } from './admin.service';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { Setting } from '@ops/settings/entities/setting.entity';

/**
 * Tìm người dùng ở trang admin (`GET /admin/users?q=`) ở quy mô một triệu
 * tài khoản (rà soát "1 triệu dòng" 28/10, mục 8).
 *
 * `full_name LIKE '%q%'` thì không index nào cứu được (đại diện ở đầu), và
 * điều đó giữ nguyên: admin cần tìm thấy cả tài khoản cũ. Nhưng hai thứ đi
 * kèm làm nó tệ hơn mức cần:
 *  · `findAndCount` đếm MỌI dòng khớp, tức luôn quét hết bảng dù trang chỉ
 *    cần 20 dòng;
 *  · `ORDER BY created_at` (không index) bắt gom mọi dòng khớp rồi mới sắp.
 * Sắp theo `id DESC` (khoá chính, tự tăng theo thứ tự tạo) thì MySQL đọc
 * ngược khoá chính và dừng khi đủ 20 dòng khớp.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

class GhiSql implements TypeOrmLogger {
  cau: string[] = [];
  logQuery(q: string) {
    this.cau.push(q);
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

describe('Admin tìm người dùng có trần', () => {
  let ds: DataSource;
  const sql = new GhiSql();
  let svc: AdminService;
  const ids: number[] = [];
  const R = Math.floor(Math.random() * 1e6);
  const TEN = `Timnd${R}`;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [
        User,
        Category,
        Product,
        Follow,
        Shop,
        Cart,
        Order,
        OrderItem,
        OrderShipment,
        Escrow,
        Setting,
      ],
      synchronize: true,
      logger: sql,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    for (let i = 0; i < 5; i++) {
      await ds.query(
        `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
        [`${TEN} ${i}`, `${TEN}-${i}@t.local`, UserRole.BUYER],
      );
      const [{ id }] = await ds.query<Array<{ id: number }>>(
        'SELECT LAST_INSERT_ID() AS id',
      );
      ids.push(Number(id));
    }
    svc = new AdminService(
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(Product),
      ds.getRepository(Setting),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM users WHERE full_name LIKE ?', [`${TEN}%`]);
      await ds.destroy();
    }
  });

  beforeEach(() => {
    sql.cau = [];
  });

  type Ket = {
    meta: { total: number; pages: number };
    result: Array<{ id: number }>;
  };

  it('kết quả như cũ: mới nhất trước, total đúng', async () => {
    const t1 = (await svc.getUsers(1, 2, TEN)) as Ket;
    const t3 = (await svc.getUsers(3, 2, TEN)) as Ket;
    const moiTruoc = [...ids].reverse();
    expect(t1.result.map((u) => u.id)).toEqual(moiTruoc.slice(0, 2));
    expect(t3.result.map((u) => u.id)).toEqual(moiTruoc.slice(4, 5));
    expect(t1.meta.total).toBe(5);
    expect(t1.meta.pages).toBe(3);
  });

  it('có q: sắp theo khoá chính, câu đếm có trần', async () => {
    await svc.getUsers(1, 2, TEN);
    const lay = sql.cau.filter(
      (c) => /FROM\s+`users`/i.test(c) && !/COUNT\s*\(/i.test(c),
    );
    expect(lay.length).toBeGreaterThan(0);
    for (const c of lay) {
      expect(c).toMatch(/ORDER BY\s+`\w+`\.`id`\s+DESC/i);
      expect(c).not.toMatch(/created_at`?\s+DESC/i);
    }
    const dem = sql.cau.filter((c) => /COUNT\s*\(/i.test(c));
    expect(dem.length).toBeGreaterThan(0);
    for (const c of dem) expect(c).toMatch(/LIMIT\s+10001/i);
  });
});
