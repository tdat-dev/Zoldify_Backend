import { DataSource } from 'typeorm';
import { EscrowsService } from './escrows.service';
import { Escrow } from './entities/escrow.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';

/**
 * BÀI KIỂM ĐỎ — BUG-18. Ký quỹ là dữ liệu tiền, không phải dữ liệu công khai.
 *
 * `escrows.controller.ts` gắn `JwtAuthGuard` cho cả bốn đường, và dừng ở đó.
 * Không đường nào hỏi NGƯỜI ĐANG GỌI LÀ AI:
 *
 *   GET /escrows               danh sách ký quỹ của CẢ SÀN
 *   GET /escrows/order/:id     ký quỹ của đơn bất kỳ
 *   GET /escrows/seller/:id    doanh thu đang giữ của người bán bất kỳ
 *   GET /escrows/held/:id      tổng tiền đang giữ của người bán bất kỳ
 *
 * Nên bất kỳ ai đăng nhập — kể cả một tài khoản vừa đăng ký — đều đọc được ai
 * mua gì của ai, bao nhiêu tiền, và mỗi shop đang có bao nhiêu tiền chờ về.
 * Đó là dữ liệu kinh doanh của người khác, và với sàn C2C thì các shop cạnh
 * tranh trực tiếp với nhau.
 *
 * `payments.service.ts` đã làm đúng khuôn này từ trước — nhận `user`, và
 * `if (user.role !== 'admin') where.user = { id: user.id }`. Ký quỹ chỉ là chỗ
 * bị bỏ sót.
 *
 * VÌ SAO ĐẶT KIỂM QUYỀN Ở SERVICE CHỨ KHÔNG CHỈ Ở CONTROLLER. Controller là
 * một cửa; service là cái két. Kiểm ở cửa thì cửa thứ hai mở ra sau này (một
 * controller khác, một job, một lời gọi nội bộ) sẽ đi thẳng vào két. Và kiểm ở
 * service thì bài kiểm này dựng được bằng hai dòng, không cần cả Nest app.
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

describe('EscrowsService — ai được xem khoản ký quỹ nào', () => {
  let ds: DataSource;
  let escrows: EscrowsService;

  let buyerId: number;
  let sellerId: number;
  let nguoiLaId: number;
  let orderId: number;

  const vai = (id: number, role: UserRole): IUser => ({
    id,
    full_name: 'x',
    email: `${id}@t.local`,
    role,
    avatar: '',
  });

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [
        User,
        Category,
        Product,
        Order,
        OrderItem,
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
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of [
      'ledger_entries',
      'ledger_transactions',
      'ledger_accounts',
      'escrows',
      'order_items',
      'orders',
      'products',
      'categories',
      'users',
      'settings',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    buyerId = await taoUser('buyer@t.local', UserRole.BUYER);
    sellerId = await taoUser('seller@t.local', UserRole.SELLER);
    nguoiLaId = await taoUser('nguoila@t.local', UserRole.BUYER);

    await ds.query(
      `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat')`,
    );
    const [cat] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories LIMIT 1',
    );
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('Mon', 'mon', 500000, 10, 'active', ?, ?)`,
      [cat.id, sellerId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM products LIMIT 1',
    );

    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, shipping_fee, final_amount,
         status, payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES ('Q-1', ?, 500000, 0, 500000, 'confirmed', 'payos', 1, 'T', '0900000000', 'addr')`,
      [buyerId],
    );
    const [o] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM orders LIMIT 1',
    );
    orderId = o.id;
    await ds.query(
      `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
       VALUES (?, ?, 'Mon', 500000, 1, 500000)`,
      [orderId, p.id],
    );

    const ledger = new LedgerService(ds);
    escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );
    await escrows.createOrderEscrows(orderId);
  });

  async function taoUser(email: string, role: UserRole): Promise<number> {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
      [email, email, role],
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    return u.id;
  }

  it('findAll — CHỈ admin mới xem được ký quỹ cả sàn', async () => {
    await expect(
      escrows.findAll(1, 20, undefined, vai(nguoiLaId, UserRole.BUYER)),
    ).rejects.toThrow();

    await expect(
      escrows.findAll(1, 20, undefined, vai(999, UserRole.ADMIN)),
    ).resolves.toBeDefined();
  });

  it('findBySeller — người lạ không xem được doanh thu đang giữ của shop khác', async () => {
    await expect(
      escrows.findBySeller(
        sellerId,
        1,
        20,
        undefined,
        vai(nguoiLaId, UserRole.BUYER),
      ),
    ).rejects.toThrow();

    // Chính người bán đó thì xem được.
    await expect(
      escrows.findBySeller(
        sellerId,
        1,
        20,
        undefined,
        vai(sellerId, UserRole.SELLER),
      ),
    ).resolves.toBeDefined();
  });

  it('getHeldBalance — người lạ không đọc được tổng tiền đang giữ của shop khác', async () => {
    await expect(
      escrows.getHeldBalance(sellerId, vai(nguoiLaId, UserRole.BUYER)),
    ).rejects.toThrow();

    await expect(
      escrows.getHeldBalance(sellerId, vai(sellerId, UserRole.SELLER)),
    ).resolves.toBeDefined();
  });

  it('findByOrder — chỉ người trong đơn (mua/bán) hoặc admin mới xem được', async () => {
    await expect(
      escrows.findByOrder(orderId, vai(nguoiLaId, UserRole.BUYER)),
    ).rejects.toThrow();

    for (const u of [
      vai(buyerId, UserRole.BUYER),
      vai(sellerId, UserRole.SELLER),
      vai(999, UserRole.ADMIN),
    ]) {
      await expect(escrows.findByOrder(orderId, u)).resolves.toBeDefined();
    }
  });

  /**
   * `?limit=999999` nạp cả bảng vào RAM. Đợt chặn limit ở PR #21 đã làm cho 6
   * service danh sách, nhưng `escrows.controller` truyền thẳng `+limit || 20`
   * xuống `take` nên lọt lưới.
   */
  it('limit bị chặn trần, không nạp cả bảng', async () => {
    const r = await escrows.findAll(
      1,
      999_999,
      undefined,
      vai(999, UserRole.ADMIN),
    );
    expect(r.meta.pageSize).toBeLessThanOrEqual(100);
  });
});
