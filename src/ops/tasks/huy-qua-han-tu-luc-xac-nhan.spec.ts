import { DataSource } from 'typeorm';
import { TasksService } from './tasks.service';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { OrdersService } from '@ordering/orders/orders.service';
import type { IUser } from '@identity/users/users.interface';

/**
 * Job huỷ đơn quá hạn đếm 48 giờ của đơn ĐÃ XÁC NHẬN từ lúc TẠO đơn.
 *
 * Đơn đặt thứ Sáu, người bán xác nhận sáng thứ Hai (hoặc GHN lỗi lúc tạo vận
 * đơn nên đơn nằm `confirmed` chờ tạo lại): vài phút sau lượt quét mỗi giờ thấy
 * `created_at` đã quá 48 giờ và huỷ, hoàn tiền một đơn người bán vừa nhận làm.
 *
 * Đúng: đơn `confirmed` đếm từ lúc được xác nhận (`confirmed_at`; đơn trả
 * trước tự sang `confirmed` lúc tiền về nên `paid_at` cũng là mốc đó), thiếu
 * cả hai thì mới lùi về `created_at`. Đơn `pending` chưa trả vẫn đếm từ lúc tạo.
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

const GIO = 3600 * 1000;

describe('Huỷ quá hạn đếm từ lúc xác nhận', () => {
  let ds: DataSource;
  let tasks: TasksService;
  let daHuy: number[];
  let buyerId: number;
  let sellerId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Order, OrderItem, OrderShipment, User, Product, Category],
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

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['order_shipments', 'order_items', 'orders', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('b','qh-b@t.local','x','buyer')`,
    );
    buyerId = await idVuaChen();
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('s','qh-s@t.local','x','seller')`,
    );
    sellerId = await idVuaChen();

    daHuy = [];
    tasks = new TasksService(
      ds.getRepository(Order),
      ds.getRepository(Product),
      {
        cancelExpired: (id: number) => {
          daHuy.push(id);
          return Promise.resolve();
        },
      } as unknown as OrdersService,
      {} as never,
    );
  });

  /** Mốc giờ phải đặt bằng SQL: @CreateDateColumn tự ghi giờ hiện tại. */
  async function taoDon(o: {
    status: OrderStatus;
    taoTruoc: number;
    xacNhanTruoc?: number;
    traTienTruoc?: number;
  }): Promise<number> {
    const luc = (h?: number) =>
      h === undefined ? null : new Date(Date.now() - h * GIO);
    const cot = [
      'order_code',
      'user_id',
      'final_amount',
      'status',
      'receiver_name',
      'receiver_phone',
      'shipping_address',
      'created_at',
      'paid_at',
      'is_paid',
    ];
    const gt: unknown[] = [
      `QH-${Math.random()}`,
      buyerId,
      1000,
      o.status,
      'N',
      '0900000000',
      'So 1',
      luc(o.taoTruoc),
      luc(o.traTienTruoc),
      o.traTienTruoc === undefined ? 0 : 1,
    ];
    if (o.xacNhanTruoc !== undefined) {
      cot.push('confirmed_at');
      gt.push(luc(o.xacNhanTruoc));
    }
    await ds.query(
      `INSERT INTO orders (${cot.join(', ')}) VALUES (${cot.map(() => '?').join(', ')})`,
      gt,
    );
    return idVuaChen();
  }

  it('đơn tạo 72 giờ trước, người bán vừa xác nhận 1 giờ trước → KHÔNG huỷ', async () => {
    await taoDon({
      status: OrderStatus.CONFIRMED,
      taoTruoc: 72,
      xacNhanTruoc: 1,
    });
    await tasks.autoCancelOrders();
    expect(daHuy).toEqual([]);
  });

  it('đơn trả trước, tiền về 1 giờ trước (tự sang confirmed) → KHÔNG huỷ', async () => {
    await taoDon({
      status: OrderStatus.CONFIRMED,
      taoTruoc: 72,
      traTienTruoc: 1,
    });
    await tasks.autoCancelOrders();
    expect(daHuy).toEqual([]);
  });

  it('xác nhận đã quá 48 giờ mà chưa gửi hàng → huỷ', async () => {
    const id = await taoDon({
      status: OrderStatus.CONFIRMED,
      taoTruoc: 80,
      xacNhanTruoc: 50,
    });
    await tasks.autoCancelOrders();
    expect(daHuy).toEqual([id]);
  });

  it('đơn xác nhận từ trước khi có cột mốc (NULL) → đếm từ lúc tạo', async () => {
    const id = await taoDon({ status: OrderStatus.CONFIRMED, taoTruoc: 72 });
    await tasks.autoCancelOrders();
    expect(daHuy).toEqual([id]);
  });

  it('đơn chờ xác nhận vẫn đếm từ lúc tạo', async () => {
    const id = await taoDon({
      status: OrderStatus.PENDING,
      taoTruoc: 72,
      xacNhanTruoc: 1,
    });
    await tasks.autoCancelOrders();
    expect(daHuy).toEqual([id]);
  });

  it('người bán xác nhận qua updateStatus thì ghi confirmed_at', async () => {
    await ds.query(
      `INSERT INTO categories (name, slug) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE slug = slug`,
      ['QH cat', 'qh-cat'],
    );
    const [c] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories WHERE slug = 'qh-cat'`,
    );
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('SP', ?, 1000, 5, ?, ?, ?)`,
      [`qh-${Math.random()}`, ProductStatus.ACTIVE, c.id, sellerId],
    );
    const pid = await idVuaChen();
    const id = await taoDon({ status: OrderStatus.PENDING, taoTruoc: 30 });
    await ds.query(
      `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
       VALUES (?, ?, 'SP', 1000, 1, 1000)`,
      [id, pid],
    );

    const orders = new OrdersService(
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds.getRepository(OrderShipment),
      {} as never,
      {} as never,
      ds.getRepository(Product),
      ds.getRepository(User),
      { create: () => Promise.resolve(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      ds,
      {} as never,
    );
    const nguoiBan = { id: sellerId, role: UserRole.SELLER } as IUser;
    const truoc = Date.now();
    await orders.updateStatus(id, { status: OrderStatus.CONFIRMED }, nguoiBan);

    const [d] = await ds.query<Array<{ confirmed_at: Date | null }>>(
      'SELECT confirmed_at FROM orders WHERE id = ?',
      [id],
    );
    expect(d.confirmed_at).not.toBeNull();
    // Cột datetime cắt mili giây: so với mốc trước lời gọi, lùi một giây.
    expect(new Date(d.confirmed_at as Date).getTime()).toBeGreaterThanOrEqual(
      truoc - 1000,
    );
  });
});
