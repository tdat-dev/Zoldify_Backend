import { DataSource } from 'typeorm';
import { PayosService } from './payos.service';
import { Payment } from '@money/payments/entities/payment.entity';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { EscrowsService } from '@money/escrows/escrows.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * BÀI KIỂM ĐỎ — BUG-15. Không mở cổng trả tiền cho đơn đã đóng.
 *
 * `createOrderPaymentLink` kiểm `order.user.id !== userId` và `order.is_paid`,
 * rồi gọi thẳng PayOS. Nó KHÔNG nhìn `order.status` một lần nào — nên người
 * mua huỷ đơn xong vẫn tạo được link mới và trả tiền vào đó.
 *
 * `applyPaidPayment` có lưới đỡ (nhánh `paidAfterCancel`: tiền về ví người mua
 * thay vì hồi sinh đơn). Nhưng đó là lưới CUỐI cho link đã phát trước khi huỷ.
 * Mở một cổng MỚI cho đơn đã huỷ thì người mua trả tiền cho một thứ không còn
 * tồn tại, rồi phải tự đi rút lại.
 *
 * `cancel()` đã gọi `voidOpenLinkForOrder` để đóng link cũ — thiếu bước kiểm
 * này thì công đóng đó vô nghĩa.
 *
 * KHÔNG GỌI RA MẠNG. Bước kiểm nằm TRƯỚC lời gọi PayOS, nên bài kiểm chạm đúng
 * nhánh từ chối mà không cần sandbox. Khoá PayOS để chuỗi giả.
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

describe('PayosService — link thanh toán chỉ cho đơn còn sống', () => {
  let ds: DataSource;
  let payos: PayosService;
  let buyerId: number;

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
        Payment,
        Wallet,
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

    const ledger = new LedgerService(ds);
    const escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );

    payos = new PayosService(
      { get: () => 'test' } as never,
      {} as never,
      ds.getRepository(Payment),
      ds.getRepository(Order),
      ds.getRepository(Wallet),
      ds.getRepository(User),
      ds,
      ledger,
      escrows,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['payments', 'order_items', 'orders', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('b','b@t.local','x','buyer')`,
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      "SELECT id FROM users WHERE email = 'b@t.local'",
    );
    buyerId = u.id;
  });

  async function taoDon(status: OrderStatus): Promise<number> {
    const code = `L-${status}-${Date.now()}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, final_amount, status,
         payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, 100000, 100000, ?, 'payos', 0, 'T', '0900000000', 'addr')`,
      [code, buyerId, status],
    );
    const [o] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM orders WHERE order_code = ?',
      [code],
    );
    return o.id;
  }

  it('đơn ĐÃ HUỶ thì không tạo được link thanh toán', async () => {
    const id = await taoDon(OrderStatus.CANCELLED);
    await expect(payos.createOrderPaymentLink(id, buyerId)).rejects.toThrow(
      /huỷ|trạng thái/i,
    );
  });

  it('đơn ĐÃ HOÀN TIỀN cũng không tạo được', async () => {
    const id = await taoDon(OrderStatus.REFUNDED);
    await expect(payos.createOrderPaymentLink(id, buyerId)).rejects.toThrow();
  });

  it('đơn ĐÃ GIAO cũng không tạo được', async () => {
    const id = await taoDon(OrderStatus.DELIVERED);
    await expect(payos.createOrderPaymentLink(id, buyerId)).rejects.toThrow();
  });

  /**
   * ĐỐI CHỨNG. Đơn `pending` phải đi QUA bước kiểm trạng thái — nó sẽ hỏng ở
   * lời gọi PayOS (khoá giả, không có mạng), và đó là dấu hiệu nó đã qua được
   * cửa. Nếu ca này cũng ném thông báo về trạng thái thì bộ lọc đang chặn
   * nhầm cả đơn hợp lệ.
   */
  it('[đối chứng] đơn pending KHÔNG bị chặn ở bước kiểm trạng thái', async () => {
    const id = await taoDon(OrderStatus.PENDING);
    await expect(payos.createOrderPaymentLink(id, buyerId)).rejects.not.toThrow(
      /trạng thái/i,
    );
  });
});
