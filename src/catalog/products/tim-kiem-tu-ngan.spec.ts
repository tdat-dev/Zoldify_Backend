import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { createCache } from 'cache-manager';
import * as ProductsModule from './products.service';
import { ProductsService } from './products.service';
import { Product, ProductStatus } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * Tìm kiếm từ NGẮN quét cả bảng (rà soát "1 triệu dòng" 28/10, mục 3).
 *
 * Câu tìm dưới 4 ký tự ("áo", "tủ", "xe", "tv") rơi vào `name LIKE '%áo%'`:
 * ký tự đại diện ở ĐẦU nên không index nào dùng được, MySQL đọc từng dòng
 * trong một triệu dòng ở mỗi request, rồi còn COUNT cả tập khớp. Mà tiếng
 * Việt có rất nhiều từ hai chữ cái có nghĩa, nên KHÔNG được chặn câu ngắn.
 *
 * Bài này đo ba điều:
 *  · "áo" vẫn ra đúng hàng áo (cả khi "áo" đứng giữa tên), và không ra
 *    "Bảo hiểm" (chuỗi con "ao" nằm giữa một từ khác);
 *  · không câu nào gửi mẫu `%áo%` (đại diện ở đầu, quét cả bảng);
 *  · tập được quét có trần: chỉ trong `cuaSoTuNgan` món mới nhất.
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
  cau: Array<{ q: string; p: unknown[] }> = [];
  logQuery(q: string, p?: unknown[]) {
    this.cau.push({ q, p: p ?? [] });
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

/** Cấu hình trần cửa sổ; bản trước khi sửa chưa có nên đọc lỏng. */
type GioiHan = { cuaSoTuNgan: number };
const gioiHan = (): GioiHan | undefined =>
  (ProductsModule as unknown as { GIOI_HAN_TIM_KIEM?: GioiHan })
    .GIOI_HAN_TIM_KIEM;

describe('Tìm kiếm từ ngắn có trần, không quét cả bảng', () => {
  let ds: DataSource;
  const sql = new GhiSql();
  let sellerId: number;
  let catId: number;
  const R = Math.floor(Math.random() * 1e6);

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  async function them(ten: string): Promise<number> {
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES (?, ?, 1000, 5, ?, ?, ?)`,
      [ten, `tkn-${R}-${Math.random()}`, ProductStatus.ACTIVE, catId, sellerId],
    );
    return idVuaChen();
  }

  const moi = () =>
    new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      {} as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, Category, Product, Follow, Shop],
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
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('ban', ?, 'x', ?)`,
      [`tkn-${R}@t.local`, UserRole.SELLER],
    );
    sellerId = await idVuaChen();
    await ds.query(`INSERT INTO categories (name, slug) VALUES (?, ?)`, [
      `Tim ngan ${R}`,
      `tim-ngan-${R}`,
    ]);
    catId = await idVuaChen();
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM products WHERE seller_id = ?', [sellerId]);
      await ds.query('DELETE FROM categories WHERE id = ?', [catId]);
      await ds.query('DELETE FROM users WHERE id = ?', [sellerId]);
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM products WHERE seller_id = ?', [sellerId]);
    sql.cau = [];
  });

  type Ket = { meta: { total: number }; result: Array<{ name: string }> };

  it('"áo" ra hàng áo (đầu tên và giữa tên), không ra "Bảo hiểm"', async () => {
    await them('Áo thun nam');
    await them('Combo áo khoác gió');
    await them('Giày thể thao');
    await them('Bảo hiểm màn hình');
    sql.cau = [];

    // Cửa sổ đúng 4 món: danh mục có đủ 4 món nên câu chính PHẢI mang mốc
    // (danh mục ít hơn cửa sổ thì không cần mốc, bài sẽ không đo được gì).
    const g = gioiHan();
    const cu = g?.cuaSoTuNgan;
    if (g) g.cuaSoTuNgan = 4;
    let kq: Ket;
    try {
      kq = (await moi().findAll('1', '10', {
        q: 'áo',
        category_id: String(catId),
      })) as Ket;
    } finally {
      if (g && cu !== undefined) g.cuaSoTuNgan = cu;
    }

    expect(kq.result.map((p) => p.name).sort()).toEqual([
      'Combo áo khoác gió',
      'Áo thun nam',
    ]);
    expect(kq.meta.total).toBe(2);

    // Không mẫu LIKE nào bắt đầu bằng % rồi dính liền chữ cái: đó là mẫu
    // quét cả bảng ('%áo%'). '% áo%' (đầu một từ giữa tên) chỉ được dùng
    // bên trong cửa sổ có trần.
    const mau = sql.cau
      .flatMap((c) => c.p)
      .filter((x) => typeof x === 'string');
    expect(mau.filter((x) => /^%[^ %]/.test(x as string))).toEqual([]);
    // Câu có LIKE phải có trần: hoặc đi qua bảng con có LIMIT, hoặc bị chặn
    // bằng mốc id của cửa sổ (`id >= ?`).
    const coLike = sql.cau.filter((x) => /\bLIKE\b/i.test(x.q));
    expect(coLike.length).toBeGreaterThan(0);
    for (const c of coLike) {
      expect(c.q).toMatch(/JOIN\s*\(\s*SELECT[\s\S]*LIMIT|`id`\s*>=\s*\?/i);
    }
  });

  it('"tv", "xe" (hai chữ cái) vẫn tìm được', async () => {
    await them('Tivi cũ'); // không khớp "tv"
    await them('TV Samsung 43 inch');
    await them('Xe đạp mini');
    const svc = moi();
    const tv = (await svc.findAll('1', '10', {
      q: 'tv',
      category_id: String(catId),
    })) as Ket;
    expect(tv.result.map((p) => p.name)).toEqual(['TV Samsung 43 inch']);
    const xe = (await svc.findAll('1', '10', {
      q: 'xe',
      category_id: String(catId),
    })) as Ket;
    expect(xe.result.map((p) => p.name)).toEqual(['Xe đạp mini']);
  });

  it('tập quét có trần: chỉ trong cửa sổ món mới nhất', async () => {
    const g = gioiHan();
    expect(g).toBeDefined();
    const cu = g!.cuaSoTuNgan;
    g!.cuaSoTuNgan = 3;
    try {
      await them('Áo cũ nhất');
      for (let i = 0; i < 3; i++) await them(`Quần mới ${i}`);
      const kq = (await moi().findAll('1', '10', {
        q: 'áo',
        category_id: String(catId),
      })) as Ket;
      // "Áo cũ nhất" nằm ngoài 3 món mới nhất: đánh đổi có chủ ý.
      expect(kq.result).toEqual([]);
    } finally {
      g!.cuaSoTuNgan = cu;
    }
  });

  it('câu có từ dài vẫn đi FULLTEXT như cũ', async () => {
    await them('Áo khoác dù');
    sql.cau = [];
    const kq = (await moi().findAll('1', '10', {
      q: 'khoác',
      category_id: String(catId),
    })) as Ket;
    expect(kq.result.map((p) => p.name)).toEqual(['Áo khoác dù']);
    expect(sql.cau.some((c) => /MATCH\s*\(/i.test(c.q))).toBe(true);
  });
});
