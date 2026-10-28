import { DataSource } from 'typeorm';
import { MysqlQueryRunner } from 'typeorm/driver/mysql/MysqlQueryRunner';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import {
  OrderShipment,
  ShipmentStatus,
} from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { GhnService } from '@ordering/ghn/ghn.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { PayosService } from '@money/payos/payos.service';
import { ShipmentTrackingService } from './shipment-tracking.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User } from '@identity/users/entities/user.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';

/**
 * Tự xác nhận nhận hàng với NHIỀU lô tới hạn (rà soát "1 triệu dòng"
 * 28/10): bài kiểm viết TRƯỚC.
 *
 * `autoConfirmDueShipments` nạp MỌI lô tới hạn bằng `find()` không `take`,
 * kèm hai quan hệ (seller, order: mỗi dòng là ba entity đầy đủ). Sau một đợt
 * lễ, hay sau khi job hỏng vài ngày, số lô dồn lại là hàng nghìn, cả mảng nằm
 * trên heap 256MB của worker cho tới khi lô cuối giải ngân xong.
 *
 * Pre-mortem:
 *
 * | Rủi ro                                                  | Chặn bằng                           |
 * |---------------------------------------------------------|-------------------------------------|
 * | Vẫn nạp cả bảng, chỉ chia nhỏ lúc xử lý                 | đếm dòng MỖI câu SELECT lô (<= 200) |
 * | Lô giải ngân hỏng mãi nằm lại, vòng lặp "lấy 200 lô tới hạn" quay vô tận | lô hỏng có thật trong dữ liệu; lượt phải KẾT THÚC |
 * | Chia nhóm làm lọt lô của đơn đã huỷ (điều kiện order.status mất ở câu nạp quan hệ) | lô của đơn huỷ giữ nguyên DELIVERED |
 * | Đổi ngữ nghĩa due/released                              | due = số lô tới hạn, released = số lô giải ngân được |
 *
 * Chạy database:  npm run test:db
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(180_000);

const SO_LO = 450;

describe('OrdersService.autoConfirmDueShipments với nhiều lô', () => {
  let ds: DataSource;
  let orders: OrdersService;
  /** Đơn mà giải ngân luôn hỏng (escrow lỗi, ví khoá...). */
  let donHong: number;
  let donHuy: number;
  const daNha: number[] = [];

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
      logging: false,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['order_shipments', 'order_items', 'orders', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('m','m@t.local','x','buyer')`,
    );
    const [mua] = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );

    // SO_LO + 1 người bán, mỗi người một đơn một lô (đơn nhiều lô thì
    // reconcileOrderDelivered đọc cả đơn, không phải thứ bài này đo).
    const nguoiBan = Array.from(
      { length: SO_LO + 1 },
      (_, i) => `('s','s${i}@t.local','x','seller')`,
    );
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ${nguoiBan.join(',')}`,
    );
    await ds.query(
      `INSERT INTO orders (order_code, user_id, final_amount, status,
                           receiver_name, receiver_phone, shipping_address)
       SELECT CONCAT('ORD-', u.id), ?, 100000, 'shipping', 'N', '0900000000', 'So 1'
         FROM users u WHERE u.role = 'seller' ORDER BY u.id`,
      [mua.id],
    );
    const muoiNgayTruoc = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await ds.query(
      `INSERT INTO order_shipments
              (order_id, seller_id, tracking_code, cod_amount, status, delivered_at)
       SELECT o.id, u.id, CONCAT('GHN-', u.id), 0, 'delivered', ?
         FROM users u JOIN orders o ON o.order_code = CONCAT('ORD-', u.id)
        WHERE u.role = 'seller' ORDER BY u.id`,
      [muoiNgayTruoc],
    );

    const ds2 = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM orders ORDER BY id',
    );
    donHong = ds2[0].id;
    // Đơn cuối bị huỷ: lô của nó không được tự chốt (DA_DONG_KHONG_GIAO).
    donHuy = ds2[ds2.length - 1].id;
    await ds.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [
      donHuy,
    ]);

    const escrows = {
      release: (orderId: number) => {
        if (orderId === donHong) {
          return Promise.reject(new Error('escrow hỏng'));
        }
        daNha.push(orderId);
        return Promise.resolve(undefined);
      },
    } as unknown as EscrowsService;

    orders = new OrdersService(
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds.getRepository(OrderShipment),
      ds.getRepository(Shop),
      ds.getRepository(Cart),
      ds.getRepository(Product),
      ds.getRepository(User),
      {
        create: () => Promise.resolve(undefined),
      } as unknown as NotificationsService,
      {} as unknown as GhnService,
      escrows,
      {} as unknown as PayosService,
      {} as unknown as ShipmentTrackingService,
      ds,
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('giải ngân đủ, không câu SELECT lô nào quá 200 dòng, lô hỏng không làm treo lượt', async () => {
    const soDong: number[] = [];
    // Reflect.get: giữ hàm gốc để gọi lại với `this` của từng QueryRunner.
    const goc = Reflect.get(MysqlQueryRunner.prototype, 'query') as (
      this: MysqlQueryRunner,
      ...a: Parameters<MysqlQueryRunner['query']>
    ) => Promise<unknown>;
    const spy = jest
      .spyOn(MysqlQueryRunner.prototype, 'query')
      .mockImplementation(async function (
        this: MysqlQueryRunner,
        ...args: Parameters<MysqlQueryRunner['query']>
      ) {
        const kq: unknown = await goc.apply(this, args);
        const sql = String(args[0]);
        if (/^\s*SELECT/i.test(sql) && /FROM `order_shipments`/i.test(sql)) {
          const rows = Array.isArray(kq)
            ? kq
            : ((kq as { records?: unknown[] })?.records ?? []);
          soDong.push(rows.length);
        }
        return kq as never;
      });

    let kq: { due: number; released: number };
    try {
      kq = await orders.autoConfirmDueShipments();
    } finally {
      spy.mockRestore();
    }

    // Tới hạn: SO_LO lô (lô của đơn huỷ không tính). Giải ngân được: trừ lô hỏng.
    expect(kq).toEqual({ due: SO_LO, released: SO_LO - 1 });
    expect(new Set(daNha).size).toBe(SO_LO - 1);
    expect(Math.max(...soDong)).toBeLessThanOrEqual(200);

    const dem = await ds.query<Array<{ status: string; so: string }>>(
      `SELECT status, COUNT(*) AS so FROM order_shipments GROUP BY status`,
    );
    const theo = Object.fromEntries(dem.map((r) => [r.status, Number(r.so)]));
    expect(theo[ShipmentStatus.RECEIVED]).toBe(SO_LO - 1);
    // Lô hỏng và lô của đơn huỷ vẫn DELIVERED.
    expect(theo[ShipmentStatus.DELIVERED]).toBe(2);
    const [huy] = await ds.query<Array<{ status: string }>>(
      'SELECT status FROM order_shipments WHERE order_id = ?',
      [donHuy],
    );
    expect(huy.status).toBe(ShipmentStatus.DELIVERED);
  });
});
