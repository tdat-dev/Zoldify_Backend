import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { User } from '@identity/users/entities/user.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { StockEventsService } from '@catalog/stock/stock-events.service';

/**
 * Keyset cursor cho `/products` — bài kiểm viết TRƯỚC (Epic 4).
 *
 * VÌ SAO CÓ BÀI NÀY.
 *
 * Cuộn vô hạn ở FE ("Mới đăng gần đây") và Mobile ("Dạo chợ") đi bằng cách TĂNG
 * `current` (OFFSET) rồi dựa `meta.pages` để biết còn trang. Ở mốc 1 triệu tin,
 * `OFFSET 500000` bắt DB quét bỏ 500k dòng (~2.8s đo ở Epic 2), và mỗi lượt còn
 * một `COUNT(*)`. Keyset `(created_at,id) < con_trỏ` đi thẳng vào index, trang
 * sâu nhanh như trang đầu, lại không cần COUNT.
 *
 * ĐIỂM KHÁC ORDERS, PHẢI KIỂM KỸ: `products.created_at` là `timestamp` (GIÂY),
 * không phải timestamp(6). Nhiều tin đăng trong cùng một giây có `created_at`
 * BẰNG nhau, nên thứ tự chỉ ổn định nhờ khoá phụ `id`. Bài kiểm vì thế CHÈN
 * CỨNG `created_at` để nhiều tin trùng giây — ép đúng đường tiebreaker.
 *
 * ORACLE độc lập: thứ tự đúng = `ORDER BY created_at DESC, id DESC` tính thẳng
 * bằng một câu SQL riêng, KHÔNG gọi lại service. Đường cursor của service phải
 * tái tạo đúng dãy đó. Chưa có keyset thì service bỏ qua `cursor`, trả lại trang
 * đầu mỗi lần → đi vòng cursor ra dãy lặp, lệch oracle → ĐỎ.
 *
 * Chạy database:  npm run test:db   (rồi: npm test -- products-keyset)
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(90_000);

describe('ProductsService — keyset cursor cho danh sách mới nhất', () => {
  let ds: DataSource;
  let svc: ProductsService;
  let sellerId: number;
  let catId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Product, Category, Shop, Follow, User],
      synchronize: true,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['products', 'follows', 'shops', 'categories', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, phone_number, password, role)
       VALUES ('nguoi ban','s@t.local','0900000001','x','seller')`,
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users ORDER BY id DESC LIMIT 1',
    );
    sellerId = Number(u.id);

    await ds.query(
      `INSERT INTO categories (name, slug, is_active) VALUES ('do an','do-an',1)`,
    );
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories ORDER BY id DESC LIMIT 1',
    );
    catId = Number(c.id);

    // SÁU tin, chèn CỨNG created_at: ba tin ngày 01 và ba tin ngày 02, mỗi ngày
    // ba tin TRÙNG GIÂY nhau. Thứ tự mới nhất đúng = 02 trước (id giảm), rồi 01
    // (id giảm) → ép cả khoá chính (created_at) lẫn khoá phụ (id) cùng hoạt động.
    const seed: Array<[string, string]> = [
      ['A', '2026-01-01 00:00:00'],
      ['B', '2026-01-01 00:00:00'],
      ['C', '2026-01-01 00:00:00'],
      ['D', '2026-01-02 00:00:00'],
      ['E', '2026-01-02 00:00:00'],
      ['F', '2026-01-02 00:00:00'],
    ];
    let i = 0;
    for (const [ten, ts] of seed) {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, seller_id, category_id, status, created_at)
         VALUES (?, ?, ?, 5, ?, ?, 'active', ?)`,
        [`SP ${ten}`, `sp-${ten.toLowerCase()}-${i}`, (i + 1) * 1000, sellerId, catId, ts],
      );
      i += 1;
    }

    const cache = createCache({ ttl: 30_000 });
    const thongBaoGia = {
      create: () => Promise.resolve(undefined),
    } as unknown as NotificationsService;
    const khoPhat = {
      phat: () => Promise.resolve(),
    } as unknown as StockEventsService;

    svc = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      thongBaoGia,
      cache,
      khoPhat,
    );
  });

  type Meta = { nextCursor?: string | null; pages?: number | null; total?: number | null };
  type Row = { id: number; name: string; seller?: any };

  const goi = async (qs: Record<string, unknown>, size = '2') => {
    return (await svc.findAll('1', size, qs)) as { meta: Meta; result: Row[] };
  };

  /** Thứ tự ĐÚNG, tính độc lập — không qua service. */
  const oracleIds = async (): Promise<number[]> => {
    const rows = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM products WHERE status='active' ORDER BY created_at DESC, id DESC",
    );
    return rows.map((r) => Number(r.id));
  };

  it('trang đầu (không cursor) vẫn cấp nextCursor để bắt đầu cuộn', async () => {
    const r = await goi({ sort: 'newest' });
    expect(r.result).toHaveLength(2);
    // Trang đầy thì phải có con trỏ cho trang kế.
    expect(typeof r.meta.nextCursor).toBe('string');
    expect(r.meta.nextCursor).toBeTruthy();
  });

  it('cursor đi tiếp KHÔNG lặp lại trang trước', async () => {
    const p1 = await goi({ sort: 'newest' });
    const p2 = await goi({ sort: 'newest', cursor: p1.meta.nextCursor });

    const idsP1 = p1.result.map((x) => x.id);
    const idsP2 = p2.result.map((x) => x.id);
    // Không trùng id nào giữa hai trang.
    expect(idsP2.filter((id) => idsP1.includes(id))).toEqual([]);
    // Và trang 2 phải đứng NGAY SAU trang 1 theo oracle.
    const oracle = await oracleIds();
    expect([...idsP1, ...idsP2]).toEqual(oracle.slice(0, 4));
  });

  it('đi hết bằng cursor: lấy đúng TẤT CẢ, không sót không lặp, hết thì nextCursor rỗng', async () => {
    const oracle = await oracleIds();
    const thu: number[] = [];
    let cursor: string | null | undefined = undefined;
    // Chặn vòng lặp vô hạn nếu cursor không tiến (bug) — tối đa số tin + vài lượt.
    for (let guard = 0; guard < oracle.length + 3; guard++) {
      const r = await goi({ sort: 'newest', ...(cursor ? { cursor } : {}) });
      thu.push(...r.result.map((x) => x.id));
      cursor = r.meta.nextCursor ?? null;
      if (!cursor) break;
    }
    expect(thu).toEqual(oracle);
    expect(cursor).toBeFalsy();
  });

  it('cursor cùng giây vẫn ổn định nhờ khoá phụ id', async () => {
    // Ba tin ngày 02 trùng giây — trang đầu size 3 phải ra đúng id giảm dần.
    const r = await goi({ sort: 'newest' }, '3');
    const ids = r.result.map((x) => x.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const oracle = await oracleIds();
    expect(ids).toEqual(oracle.slice(0, 3));
  });

  it('cursor với sort KHÁC mới nhất thì 400, không trả nhầm thứ tự', async () => {
    const p1 = await goi({ sort: 'newest' });
    await expect(
      svc.findAll('1', '2', { sort: 'price_asc', cursor: p1.meta.nextCursor }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cursor kèm tìm kiếm q cũng bị từ chối 400', async () => {
    const p1 = await goi({ sort: 'newest' });
    await expect(
      svc.findAll('1', '2', { q: 'SP', cursor: p1.meta.nextCursor }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // CANH RÒ RỈ (K2): đường cursor chuyển sang QueryBuilder, dễ vô tình kéo cả
  // bảng users. Danh sách công khai KHÔNG được chứa email/phone người bán.
  it('đường cursor KHÔNG lộ email/phone người bán', async () => {
    const p1 = await goi({ sort: 'newest' });
    const p2 = await goi({ sort: 'newest', cursor: p1.meta.nextCursor });
    for (const sp of p2.result) {
      expect(sp.seller?.email).toBeUndefined();
      expect(sp.seller?.phone_number).toBeUndefined();
      // vẫn phải có phần công khai để hiển thị thẻ
      expect(sp.seller?.full_name).toBeDefined();
    }
  });
});
