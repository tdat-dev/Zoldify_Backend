import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { createCache } from 'cache-manager';
import { DOC_TU_DON, OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderShipment } from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';

/**
 * Đơn của người bán (`GET /orders?as=seller`, web /shop/orders, app màn Đơn
 * bán) ở cỡ 1 triệu dòng: bài kiểm viết TRƯỚC.
 *
 * Đo 02/11 trên zoldify_1mall (người bán nặng: 10.000 sản phẩm, 20.000 đơn),
 * `npm run loadtest` chế độ 1M: p95 5.467 ms khi một người gọi, 500 ở 20 kết
 * nối. performance_schema: `COUNT(DISTINCTROW order.id)` không trần 2.860 ms
 * trung bình, câu chọn trang 1.312 ms. Migration 1788700000000 thêm index phủ
 * cho cả ba chặng, nhưng optimizer vẫn tra đơn qua PRIMARY (đọc cả dòng, lạnh
 * 5.077 ms), nên findAll phải gợi ý index phủ của orders, và đếm có trần như
 * mọi danh sách khác (`demCoTran`).
 *
 * Pre-mortem:
 *
 * | Rủi ro                                         | Chặn bằng                                  |
 * |------------------------------------------------|--------------------------------------------|
 * | Gợi ý index làm đổi tập đơn / thứ tự           | so trang 2 với câu SQL chuẩn                |
 * | Đơn xoá mềm lọt vào                            | có một đơn xoá mềm trong dữ liệu           |
 * | Đơn nhiều món đếm thành nhiều đơn              | mỗi đơn có 2 món của cùng người bán        |
 * | Đếm vẫn COUNT(DISTINCT) không trần             | soi câu đếm                                 |
 * | Người mua / admin bị gợi ý index nhầm           | đơn của người mua vẫn đúng, không gợi ý    |
 *
 *   TEST_DB_NAME=zoldify_1mall_t npx jest don-nguoi-ban-1m
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

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

describe('OrdersService.findAll as=seller: index phủ + đếm có trần', () => {
  let ds: DataSource;
  let svc: OrdersService;
  const sql = new GhiSql();
  const R = Math.floor(Math.random() * 1e6);
  let seller: IUser;
  let khac: number;
  let buyer: IUser;

  async function lastId(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

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
        LedgerAccount,
        LedgerTransaction,
        LedgerEntry,
      ],
      synchronize: true,
      logger: sql,
    });
    await ds.initialize();
    // findAll chỉ dùng orderRepository; các phụ thuộc khác không được chạm.
    const khong = {} as never;
    svc = new OrdersService(
      ds.getRepository(Order),
      khong,
      khong,
      khong,
      khong,
      khong,
      khong,
      khong,
      khong,
      khong,
      khong,
      khong,
      ds,
      khong,
    );

    const themUser = async (ten: string, role: UserRole) => {
      await ds.query(
        `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
        [ten, `dnb-${R}-${ten}@t.local`, role],
      );
      return lastId();
    };
    seller = {
      id: await themUser('ban', UserRole.SELLER),
      role: UserRole.SELLER,
    } as unknown as IUser;
    khac = await themUser('khac', UserRole.SELLER);
    buyer = {
      id: await themUser('mua', UserRole.BUYER),
      role: UserRole.BUYER,
    } as unknown as IUser;

    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, seller_id)
       WITH RECURSIVE s (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 39)
       SELECT CONCAT('SP ', n), CONCAT('dnb-${R}-', n), 1000, 5, 'active',
              IF(n < 30, ?, ?) FROM s`,
      [seller.id, khac],
    );
    const sp = await ds.query<Array<{ id: number; seller_id: number }>>(
      'SELECT id, seller_id FROM products WHERE slug LIKE ? ORDER BY id',
      [`dnb-${R}-%`],
    );
    const cuaBan = sp.filter((p) => p.seller_id === seller.id).map((p) => p.id);
    const cuaKhac = sp.filter((p) => p.seller_id === khac).map((p) => p.id);

    // 80 đơn: 60 có hàng của người bán (2 món mỗi đơn, 1/4 kèm món của người
    // khác), 20 chỉ có hàng của người khác. Đơn thứ 5 bị xoá mềm. Giờ tạo cách
    // nhau từng phút, vài cặp trùng giây để thử khoá phụ id.
    for (let i = 0; i < 80; i++) {
      await ds.query(
        `INSERT INTO orders (order_code, total_amount, final_amount, status,
                             receiver_name, receiver_phone, shipping_address,
                             user_id, created_at, deleted_at)
         VALUES (?, 2000, 2000, 'pending', 'N', '0900000000', 'D', ?,
                 NOW() - INTERVAL ? MINUTE, ?)`,
        [
          `DNB${R}-${i}`,
          buyer.id,
          i % 9 === 0 ? i + 1 : i,
          i === 5 ? new Date() : null,
        ],
      );
      const oid = await lastId();
      const mon =
        i < 60
          ? [
              cuaBan[i % 30],
              cuaBan[(i + 7) % 30],
              ...(i % 4 === 0 ? [cuaKhac[i % 10]] : []),
            ]
          : [cuaKhac[i % 10]];
      for (const p of mon) {
        await ds.query(
          `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
           VALUES (?, ?, 'SP', 1000, 1, 1000)`,
          [oid, p],
        );
      }
    }
    await ds.query('ANALYZE TABLE orders, order_items, products');
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(
        `DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE o.order_code LIKE ?`,
        [`DNB${R}-%`],
      );
      await ds.query('DELETE FROM orders WHERE order_code LIKE ?', [
        `DNB${R}-%`,
      ]);
      await ds.query('DELETE FROM products WHERE slug LIKE ?', [`dnb-${R}-%`]);
      await ds.query('DELETE FROM users WHERE email LIKE ?', [`dnb-${R}-%`]);
      await ds.destroy();
    }
  });

  type Ket = {
    meta: { total: number; pages: number };
    result: Array<{ id: number }>;
  };

  const chuanTrang2 = async () =>
    (
      await ds.query<Array<{ id: number }>>(
        `SELECT DISTINCT o.id, o.created_at FROM orders o
           JOIN order_items i ON i.order_id = o.id
           JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
          WHERE p.seller_id = ? AND o.deleted_at IS NULL
          ORDER BY o.created_at DESC, o.id DESC LIMIT 10 OFFSET 10`,
        [seller.id],
      )
    ).map((o) => Number(o.id));

  it('trang 2 đúng tập đơn và thứ tự created_at DESC, id DESC; total đúng', async () => {
    const kq = (await svc.findAll('2', '10', '', seller, 'seller')) as Ket;
    const chuan = await ds.query<Array<{ id: number }>>(
      `SELECT DISTINCT o.id, o.created_at FROM orders o
         JOIN order_items i ON i.order_id = o.id
         JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
        WHERE p.seller_id = ? AND o.deleted_at IS NULL
        ORDER BY o.created_at DESC, o.id DESC LIMIT 10 OFFSET 10`,
      [seller.id],
    );
    expect(kq.result.map((o) => o.id)).toEqual(chuan.map((o) => Number(o.id)));
    expect(kq.meta.total).toBe(59);
    expect(kq.meta.pages).toBe(6);
  });

  it('đường JOIN (trang sâu / người bán ít đơn): tra đơn bằng index phủ, đếm có trần', async () => {
    // Ép đường JOIN: trần ước lượng 0 thì không bao giờ đi từ đơn xuống.
    const cu = DOC_TU_DON.nguong;
    DOC_TU_DON.nguong = 0;
    sql.cau = [];
    try {
      const kq = (await svc.findAll('2', '10', '', seller, 'seller')) as Ket;
      expect(kq.result.map((o) => o.id)).toEqual(await chuanTrang2());
    } finally {
      DOC_TU_DON.nguong = cu;
    }
    const dem = sql.cau.filter((c) => /COUNT\(/i.test(c.q));
    expect(dem.length).toBeGreaterThan(0);
    for (const c of dem) expect(c.q).toMatch(/\bLIMIT\b/i);

    const trang = sql.cau.find(
      (c) =>
        /FROM `orders`/.test(c.q) &&
        /`order_items`/.test(c.q) &&
        /ORDER BY/.test(c.q) &&
        !/COUNT\(/i.test(c.q),
    );
    expect(trang).toBeDefined();
    const plan = await ds.query<Array<{ table: string; key: string | null }>>(
      `EXPLAIN ${trang!.q}`,
      trang!.p,
    );
    const don = plan.find((d) => d.table === 'order');
    expect(don?.key).toBe('idx_id_deleted_status_created');
  });

  // Người bán chiếm phần lớn đơn (59/80 ở đây, 2% ở seed-1m): đi từ đơn mới
  // nhất xuống, hỏi EXISTS từng đơn, không gom hết đơn của người bán rồi sắp.
  // Đo trên zoldify_1mall: trang đầu 21 ms thay vì 165 ms ấm / 1.216 ms dưới
  // tải của câu JOIN.
  it('người bán nhiều đơn: trang đầu đi từ đơn xuống bằng EXISTS, cùng kết quả', async () => {
    // Ép đường đi từ đơn: quyết định dựa vào MAX(orders.id) của CẢ bảng, mà
    // database test dùng chung có id tự tăng rất lớn sau nhiều lượt chạy nên
    // ước lượng ở đây vô nghĩa. Bài này gác hình dạng và kết quả của đường đó.
    const cu = DOC_TU_DON.nguong;
    DOC_TU_DON.nguong = Number.MAX_SAFE_INTEGER;
    try {
      sql.cau = [];
      const kq = (await svc.findAll('2', '10', '', seller, 'seller')) as Ket;
      expect(kq.result.map((o) => o.id)).toEqual(await chuanTrang2());
      const trang = sql.cau.find(
        (c) =>
          /FROM `orders`/.test(c.q) &&
          /ORDER BY/.test(c.q) &&
          !/COUNT\(/i.test(c.q) &&
          /LIMIT/.test(c.q),
      );
      expect(trang?.q).toMatch(/EXISTS/);
      expect(trang?.q).not.toMatch(/INNER JOIN `order_items` `item`/);
    } finally {
      DOC_TU_DON.nguong = cu;
    }
  });

  it('đơn của người mua không đổi', async () => {
    const kq = (await svc.findAll('1', '100', '', buyer)) as Ket;
    expect(kq.result).toHaveLength(79);
    expect(kq.meta.total).toBe(79);
  });

  // Đếm có trần vẫn phải gom tới 10.001 đơn khác nhau: với người bán 20.000
  // đơn, nó tốn ngang câu chọn trang. Đo lại sau index phủ + USE INDEX: p95
  // 604 ms một người gọi, 2.664 ms ở 20 kết nối, vì MỖI lần mở màn Đơn bán
  // chạy cả hai câu. Tổng nhớ 60 giây theo (người bán, trạng thái), giống
  // tổng của danh sách sản phẩm: đơn mới vào thì con số trễ tối đa một phút,
  // còn danh sách đơn vẫn tươi.
  it('lần mở thứ hai trong 60 giây không đếm lại', async () => {
    const coCache = new OrdersService(
      ds.getRepository(Order),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      ds,
      {} as never,
      undefined,
      createCache({ ttl: 60_000 }),
    );
    await coCache.findAll('1', '10', '', seller, 'seller');
    sql.cau = [];
    const kq = (await coCache.findAll('2', '10', '', seller, 'seller')) as Ket;
    expect(kq.meta.total).toBe(59);
    expect(sql.cau.filter((c) => /COUNT\(/i.test(c.q))).toEqual([]);
  });
});
