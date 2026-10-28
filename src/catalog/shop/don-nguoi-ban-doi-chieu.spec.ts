import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { ShopService } from './shop.service';
import { Shop } from './entities/shop.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * GET /shop/:sellerId/orders ở quy mô lớn (rà soát "1 triệu dòng" 28/10,
 * mục 6), đối chiếu với thuật toán cũ trên dữ liệu có đơn NHIỀU người bán.
 *
 * Ba thứ phải giữ nguyên so với bản cũ (COUNT DISTINCT + GROUP BY qua
 * order_items -> products): tập đơn, thứ tự (id đơn giảm dần), và chỉ món của
 * chính người bán trong mỗi đơn.
 *
 * VÌ SAO KHÔNG TÌM ĐƠN QUA `order_shipments.seller_id`. Rà soát đề nghị vậy
 * vì nó có index và một dòng cho mỗi (đơn, người bán). Nhưng dòng vận đơn chỉ
 * được TẠO lúc người bán bấm giao (tạo vận đơn GHN, `OrdersService`), không
 * phải lúc đặt hàng: đơn `pending`/`confirmed` chưa giao không có dòng nào.
 * Tìm qua bảng đó là người bán không thấy đơn mới đặt, đúng những đơn họ cần
 * xử lý nhất. Bài này gieo đúng trường hợp ấy (đơn chờ, chưa có vận đơn).
 *
 * Phần ĐỎ trước bản vá: trang quá sâu vẫn gửi OFFSET sâu, và câu đếm không
 * có trần.
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

function offsetLonNhat(cau: string[]): number {
  let max = 0;
  for (const c of cau) {
    for (const m of c.matchAll(/OFFSET\s+(\d+)/gi)) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

describe('Đơn của người bán: đối chiếu bản cũ, có trần', () => {
  let ds: DataSource;
  const sql = new GhiSql();
  let svc: ShopService;
  let sellerA: number;
  let sellerB: number;
  let buyer: number;
  let donChoChuaVanDon: number;

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  /** Thuật toán CŨ, viết lại bằng SQL thô làm chuẩn đối chiếu. */
  async function idCu(seller: number, status?: string): Promise<number[]> {
    const rows = await ds.query<Array<{ id: number }>>(
      `SELECT o.id FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
        WHERE p.seller_id = ? AND o.deleted_at IS NULL
          ${status ? 'AND o.status = ?' : ''}
        GROUP BY o.id ORDER BY o.id DESC`,
      status ? [seller, status] : [seller],
    );
    return rows.map((r) => Number(r.id));
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
    svc = new ShopService(
      ds.getRepository(Shop),
      ds.getRepository(User),
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(OrderItem),
    );

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
      'escrows',
      'order_shipments',
      'order_items',
      'orders',
      'carts',
      'products',
      'follows',
      'shops',
      'categories',
      'users',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    const nguoi = async (ten: string, vai: UserRole) => {
      await ds.query(
        `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
        [ten, `${ten}@doichieu.local`, vai],
      );
      return idVuaChen();
    };
    sellerA = await nguoi('banA', UserRole.SELLER);
    sellerB = await nguoi('banB', UserRole.SELLER);
    buyer = await nguoi('mua', UserRole.BUYER);
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('DC', 'dc')`);
    const cat = await idVuaChen();
    const sp = async (seller: number, i: number) => {
      await ds.query(
        `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
         VALUES (?, ?, 1000, 99, ?, ?, ?)`,
        [
          `SP ${seller}-${i}`,
          `dc-${seller}-${i}`,
          ProductStatus.ACTIVE,
          cat,
          seller,
        ],
      );
      return idVuaChen();
    };
    const a1 = await sp(sellerA, 1);
    const a2 = await sp(sellerA, 2);
    const b1 = await sp(sellerB, 1);

    // [trạng thái, sản phẩm, có vận đơn của người bán nào, xoá mềm]
    const kichBan: Array<[string, number[], number[], boolean]> = [
      ['pending', [a1], [], false], // đơn chờ, chưa vận đơn
      ['pending', [a1, b1], [], false], // nhiều người bán, chưa vận đơn
      ['confirmed', [a2], [], false],
      ['shipping', [a1, a2, b1], [sellerA, sellerB], false],
      ['shipping', [b1], [sellerB], false], // chỉ B
      ['delivered', [a1, b1], [sellerA, sellerB], false],
      ['delivered', [a2], [sellerA], true], // đã xoá mềm
      ['cancelled', [a1, a2], [], false],
      ['pending', [a2, b1], [], false],
      ['delivered', [a1], [sellerA], false],
    ];
    let k = 0;
    for (const [st, sps, lo, xoa] of kichBan) {
      await ds.query(
        `INSERT INTO orders (order_code, user_id, final_amount, status,
                             receiver_name, receiver_phone, shipping_address, deleted_at)
         VALUES (?, ?, 1000, ?, 'N', '0900000000', 'So 1', ?)`,
        [`DC-${k++}`, buyer, st, xoa ? new Date() : null],
      );
      const oid = await idVuaChen();
      if (k === 1) donChoChuaVanDon = oid;
      for (const pid of sps) {
        await ds.query(
          `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
           VALUES (?, ?, 'SP', 1000, 1, 1000)`,
          [oid, pid],
        );
      }
      for (const s of lo) {
        await ds.query(
          `INSERT INTO order_shipments (order_id, seller_id, cod_amount, status) VALUES (?, ?, 0, 'created')`,
          [oid, s],
        );
      }
    }
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(() => {
    sql.cau = [];
  });

  type Ket = {
    meta: { total: number; pages: number };
    result: Array<{ id: number; items: Array<{ product: { id: number } }> }>;
  };
  const la = (id: number): IUser => ({ id, role: 'seller' }) as IUser;

  it.each([
    ['A, mọi trạng thái', () => sellerA, undefined],
    ['A, pending', () => sellerA, 'pending'],
    ['A, delivered', () => sellerA, 'delivered'],
    ['B, mọi trạng thái', () => sellerB, undefined],
  ] as Array<[string, () => number, string | undefined]>)(
    '%s: cùng tập đơn, cùng thứ tự, cùng total với bản cũ ở mọi cỡ trang',
    async (_ten, ai, status) => {
      const seller = ai();
      const chuan = await idCu(seller, status);
      for (const co of [1, 2, 3, 20]) {
        const gom: number[] = [];
        for (
          let trang = 1;
          trang <= Math.ceil(chuan.length / co) + 1;
          trang++
        ) {
          const kq = (await svc.getSellerOrders(
            seller,
            trang,
            co,
            status,
            la(seller),
          )) as Ket;
          expect(kq.meta.total).toBe(chuan.length);
          expect(kq.meta.pages).toBe(Math.ceil(chuan.length / co));
          gom.push(...kq.result.map((d) => d.id));
          // Chỉ món của chính người bán này.
          const cuaMinh = await ds.query<Array<{ id: number }>>(
            'SELECT id FROM products WHERE seller_id = ?',
            [seller],
          );
          const idSp = new Set(cuaMinh.map((r) => Number(r.id)));
          for (const d of kq.result) {
            expect(d.items.length).toBeGreaterThan(0);
            for (const it of d.items)
              expect(idSp.has(it.product.id)).toBe(true);
          }
        }
        expect(gom).toEqual(chuan);
      }
    },
  );

  it('đơn chờ chưa có vận đơn vẫn hiện (lý do không dùng order_shipments)', async () => {
    const kq = (await svc.getSellerOrders(
      sellerA,
      1,
      100,
      'pending',
      la(sellerA),
    )) as Ket;
    expect(kq.result.map((d) => d.id)).toContain(donChoChuaVanDon);
    const [{ n }] = await ds.query<Array<{ n: string }>>(
      'SELECT COUNT(*) n FROM order_shipments WHERE order_id = ?',
      [donChoChuaVanDon],
    );
    expect(Number(n)).toBe(0);
  });

  it('trang quá sâu: rỗng, không OFFSET sâu; câu đếm có trần', async () => {
    const sau = (await svc.getSellerOrders(
      sellerA,
      9000,
      20,
      undefined,
      la(sellerA),
    )) as Ket;
    expect(sau.result).toEqual([]);
    expect(offsetLonNhat(sql.cau)).toBeLessThan(10_000);

    sql.cau = [];
    await svc.getSellerOrders(sellerA, 1, 2, undefined, la(sellerA));
    const dem = sql.cau.filter((c) => /COUNT\s*\(/i.test(c));
    expect(dem.length).toBeGreaterThan(0);
    for (const c of dem) expect(c).toMatch(/LIMIT\s+10001/i);
  });
});
