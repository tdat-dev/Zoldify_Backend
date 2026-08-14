import { DataSource } from 'typeorm';
import { TasksService } from './tasks.service';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { User } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { OrdersService } from '@ordering/orders/orders.service';

/**
 * Job quá hạn CHỌN đúng đơn nào.
 *
 * Việc huỷ đã có bài kiểm riêng ở `escrows.service.spec.ts` và
 * `payos.service.spec.ts`; ở đây chỉ kiểm phần mà job tự quyết định — câu truy
 * vấn tìm đơn. Đó cũng là chỗ bản cũ sai nguy hiểm nhất: nó quét cả đơn ĐÃ CÓ
 * MÃ VẬN ĐƠN, tức là hoàn tiền cho người mua trong khi kiện hàng đang trên
 * đường tới nhà họ.
 *
 * `OrdersService` được thay bằng bản giả chỉ ghi lại id: bài kiểm này hỏi "job
 * gọi huỷ những đơn nào", không hỏi "huỷ chạy ra sao".
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

jest.setTimeout(60_000);

describe('TasksService — chọn đơn quá hạn', () => {
  let ds: DataSource;
  let tasks: TasksService;
  let cancelled: number[];
  let userId: number;

  const HOURS = 3600 * 1000;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      // Product/Category không dùng trực tiếp ở đây, nhưng OrderItem có quan hệ
      // tới Product nên TypeORM đòi đủ chuỗi mới dựng được metadata.
      entities: [Order, OrderItem, User, Product, Category],
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
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['order_items', 'orders', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('b','b@t.local','x','buyer')`,
    );
    const [row] = await ds.query(
      `SELECT id FROM users WHERE email = 'b@t.local'`,
    );
    userId = row.id;

    cancelled = [];
    const ordersService = {
      cancelExpired: async (id: number) => {
        cancelled.push(id);
      },
    } as unknown as OrdersService;

    tasks = new TasksService(ds.getRepository(Order), ordersService);
  });

  /** created_at phải đặt bằng SQL: cột @CreateDateColumn tự ghi giờ hiện tại. */
  async function makeOrder(opts: {
    status: OrderStatus;
    ageHours: number;
    trackingCode?: string;
  }): Promise<number> {
    const code = `T-${opts.status}-${opts.ageHours}-${opts.trackingCode ?? 'x'}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, final_amount, status,
        payment_method, receiver_name, receiver_phone, shipping_address,
        tracking_code, created_at)
       VALUES (?, ?, 100000, 100000, ?, 'payos', 'T', '0900000000', 'addr', ?, ?)`,
      [
        code,
        userId,
        opts.status,
        opts.trackingCode ?? null,
        new Date(Date.now() - opts.ageHours * HOURS),
      ],
    );
    const [o] = await ds.query('SELECT id FROM orders WHERE order_code = ?', [
      code,
    ]);
    return o.id;
  }

  it('huỷ đơn chờ xác nhận đã để quá 48 giờ', async () => {
    const stale = await makeOrder({
      status: OrderStatus.PENDING,
      ageHours: 72,
    });
    await makeOrder({ status: OrderStatus.PENDING, ageHours: 2 });

    await tasks.autoCancelOrders();

    expect(cancelled).toEqual([stale]);
  });

  it('KHÔNG đụng đơn đã có mã vận đơn, dù quá hạn bao lâu', async () => {
    // Kiện hàng đã ở chỗ GHN. Huỷ ở đây là hoàn tiền cho người mua trong khi
    // hàng vẫn đang đi tới tay họ — bản cũ quét cả những đơn này.
    await makeOrder({
      status: OrderStatus.CONFIRMED,
      ageHours: 500,
      trackingCode: 'GHN123456',
    });

    await tasks.autoCancelOrders();

    expect(cancelled).toEqual([]);
  });

  it('không đụng đơn đã giao hay đã huỷ', async () => {
    await makeOrder({ status: OrderStatus.DELIVERED, ageHours: 200 });
    await makeOrder({ status: OrderStatus.CANCELLED, ageHours: 200 });

    await tasks.autoCancelOrders();

    expect(cancelled).toEqual([]);
  });

  it('một đơn hỏng không làm dừng cả lượt quét', async () => {
    const a = await makeOrder({ status: OrderStatus.PENDING, ageHours: 100 });
    const b = await makeOrder({ status: OrderStatus.CONFIRMED, ageHours: 100 });

    const boom = {
      cancelExpired: async (id: number) => {
        cancelled.push(id);
        if (id === a) throw new Error('hoàn tiền hỏng');
      },
    } as unknown as OrdersService;
    tasks = new TasksService(ds.getRepository(Order), boom);

    await expect(tasks.autoCancelOrders()).resolves.toBeUndefined();
    expect(cancelled.sort()).toEqual([a, b].sort());
  });
});
