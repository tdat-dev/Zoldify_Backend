import { DataSource } from 'typeorm';
import { EscrowsService } from './escrows.service';
import { Escrow } from './entities/escrow.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * BÀI KIỂM ĐỎ — két giữ hộ (`platform/escrow_hold`) không khớp với các khoản
 * ký quỹ treo trên nó.
 *
 * Hai bất biến mà cả kiến trúc sổ cái sinh ra để bảo vệ, và cả hai đang gãy:
 *
 *   (1) Không giải ngân được khoản ký quỹ chưa có tiền đối ứng.
 *       `ledger.post()` chỉ chặn tài khoản NGƯỜI DÙNG âm; tài khoản platform
 *       được phép âm (đúng, `gateway_clearing` phải âm dần). Nhưng
 *       `escrow_hold` âm thì nghĩa khác hẳn: sàn vừa trả cho người bán một số
 *       tiền chưa ai nộp vào.
 *
 *   (2) Đơn kết thúc trọn vẹn thì `escrow_hold` phải về 0.
 *       Tiền vào két là `final_amount` (có phí ship), tiền ra khỏi két là
 *       `Σ subtotal` (không phí ship). Chênh lệch nằm lại mãi mãi.
 *
 * Các `it` dưới đây dựng lại ĐÚNG bút toán mà `payos.service.ts:586-604` ghi
 * khi webhook báo đã trả tiền, rồi đo két sau mỗi bước.
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

describe('Escrow — két giữ hộ phải khớp với tiền thật', () => {
  let ds: DataSource;
  let ledger: LedgerService;
  let escrows: EscrowsService;

  let buyerId: number;
  let sellerId: number;
  let productId: number;

  const TIEN_HANG = 500_000;
  const PHI_SHIP = 30_000;
  const DA_TRA = TIEN_HANG + PHI_SHIP;

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

    await ds.query(
      `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat')`,
    );
    const [cat] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('Mon hang', 'mon-hang', ?, 10, 'active', ?, ?)`,
      [TIEN_HANG, cat.id, sellerId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM products LIMIT 1`,
    );
    productId = p.id;

    ledger = new LedgerService(ds);
    escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );
  });

  async function taoUser(email: string, role: UserRole): Promise<number> {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES (?, ?, 'x', ?)`,
      [email, email, role],
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM users WHERE email = ?`,
      [email],
    );
    return u.id;
  }

  async function taoDon(isPaid: boolean): Promise<number> {
    const code = `E-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, shipping_fee, final_amount,
         status, payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, ?, ?, ?, 'payos', ?, 'T', '0900000000', 'addr')`,
      [
        code,
        buyerId,
        TIEN_HANG,
        PHI_SHIP,
        DA_TRA,
        isPaid ? 'confirmed' : 'pending',
        isPaid ? 1 : 0,
      ],
    );
    const [o] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM orders WHERE order_code = ?`,
      [code],
    );
    await ds.query(
      `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
       VALUES (?, ?, 'Mon hang', ?, 1, ?)`,
      [o.id, productId, TIEN_HANG, TIEN_HANG],
    );
    return o.id;
  }

  /**
   * Bản sao ĐÚNG bút toán của webhook PayOS: `gateway_clearing -> escrow_hold`,
   * số tiền là `final_amount` (payos.service.ts:511 lấy `payment.amount`, mà
   * payment.amount được đặt bằng `order.final_amount`).
   */
  async function webhookDaTraTien(orderId: number) {
    const gw = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    const hold = await ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );
    await ledger.post({
      idempotencyKey: `test_order_hold:${orderId}`,
      type: LedgerTxType.ORDER_HOLD,
      reference: { type: 'order', id: orderId },
      entries: [
        { accountId: Number(gw.id), amount: -BigInt(DA_TRA) },
        { accountId: Number(hold.id), amount: BigInt(DA_TRA) },
      ],
    });
  }

  const ketGiuHo = () =>
    ledger.getBalance(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

  const viCua = (id: number) =>
    ledger.getBalance(LedgerOwnerType.USER, id, LedgerPurpose.AVAILABLE);

  /**
   * TC-P0-02 — BUG-02.
   *
   * `payos.controller.ts:55` gọi `createOrderEscrows` NGAY SAU khi tạo link
   * thanh toán, lúc người mua chưa trả đồng nào. Khoản ký quỹ ra đời ở trạng
   * thái `holding` trong khi két giữ hộ vẫn rỗng.
   */
  it('TC-P0-02 — không sinh ký quỹ cho đơn chưa trả tiền', async () => {
    const orderId = await taoDon(false);

    // Từ chối THẲNG chứ không lặng lẽ bỏ qua: người gọi phải biết mình vừa yêu
    // cầu một việc vô nghĩa, thay vì tưởng đã tạo xong rồi đi tiếp.
    await expect(escrows.createOrderEscrows(orderId)).rejects.toThrow();

    // Và quan trọng hơn lời từ chối: không được còn sót dòng nào.
    const rows = await ds
      .getRepository(Escrow)
      .find({ where: { order: { id: orderId } } });
    expect(rows).toHaveLength(0);
  });

  /**
   * TC-P0-02b — BUG-02, phần mất tiền thật.
   *
   * Ký quỹ đã tồn tại (TC-P0-02) nhưng két rỗng. Người mua bấm "đã nhận hàng"
   * → `release()` → người bán được cộng tiền, và `escrow_hold` xuống ÂM.
   *
   * Số âm đó là tiền sàn vừa trả cho người bán mà chưa ai nộp vào. Người bán
   * rút ra được qua `POST /withdrawals`.
   */
  it('TC-P0-02b — giải ngân không được làm két giữ hộ âm', async () => {
    const orderId = await taoDon(false);

    // Hai lời gọi này ĐƯỢC PHÉP ném — bài kiểm không đo chúng, nó đo SỐ DƯ còn
    // lại sau khi một đường "lấy tiền" đã bị thử tới cùng.
    await escrows.createOrderEscrows(orderId).catch(() => undefined);
    await escrows.release(orderId, sellerId).catch(() => undefined);

    expect(await ketGiuHo()).toBeGreaterThanOrEqual(0n);
    expect(await viCua(sellerId)).toBe(0n);
  });

  /**
   * TC-P0-04a — BUG-04.
   *
   * Người mua trả `final_amount` = 530.000 (hàng 500.000 + ship 30.000).
   * Huỷ đơn thì phải nhận lại đủ 530.000.
   *
   * Nhưng `createOrderEscrows` chỉ tách `Σ item.subtotal` = 500.000, nên
   * `refund()` chỉ hoàn được 500.000. 30.000 phí ship của người mua nằm lại
   * trong két, không bút toán nào đưa nó ra.
   */
  it('TC-P0-04a — huỷ đơn đã trả tiền thì hoàn ĐỦ số đã trả', async () => {
    const orderId = await taoDon(true);
    await webhookDaTraTien(orderId);
    await escrows.createOrderEscrows(orderId);

    await escrows.refund(orderId);

    expect(await viCua(buyerId)).toBe(BigInt(DA_TRA));
  });

  /**
   * TC-P0-04b — BUG-04, nhìn từ phía sổ sách.
   *
   * Đơn đi hết vòng đời bình thường (trả tiền → giao xong → giải ngân) thì két
   * giữ hộ phải trở về 0: không còn đồng nào của đơn này đang được giữ.
   *
   * Hiện tại nó đọng đúng bằng phí ship, mỗi đơn một ít, mãi mãi.
   */
  it('TC-P0-04b — đơn chốt xong thì két giữ hộ về 0', async () => {
    const orderId = await taoDon(true);
    await webhookDaTraTien(orderId);
    await escrows.createOrderEscrows(orderId);

    await escrows.release(orderId);

    expect(await ketGiuHo()).toBe(0n);
  });
});
