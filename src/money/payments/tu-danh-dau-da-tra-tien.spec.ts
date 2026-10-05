import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Payment } from './entities/payment.entity';
import { WalletsService } from '@money/wallets/wallets.service';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow, EscrowStatus } from '@money/escrows/entities/escrow.entity';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import {
  PaymentMethod,
  PaymentStatus,
  PaymentType,
} from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ — hai lỗ thủng ở `PaymentsService`.
 *
 * Viết trước khi sửa, theo bước 3 của `docs/BAN-GIAO.md`. Cả hai `it` dưới đây
 * PHẢI đỏ trên `staging` hôm nay; đỏ xong mới được đụng vào mã.
 *
 * Vì sao chạy trên MySQL thật chứ không mock: hai lỗi này đều là lỗi về TRẠNG
 * THÁI SAU KHI GHI — cột `orders.is_paid`, số dòng trong `escrows`, số dư
 * `ledger_accounts`. Mock repository thì chính cái cần đo biến mất.
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

describe('PaymentsService — người mua không được tự chuyển tiền cho mình', () => {
  let ds: DataSource;
  let payments: PaymentsService;
  let wallets: WalletsService;
  let ledger: LedgerService;
  let escrows: EscrowsService;

  let buyerId: number;
  let sellerId: number;
  let productId: number;

  const TIEN_HANG = 500_000;
  const PHI_SHIP = 30_000;

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
        Payment,
        Wallet,
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
      'payments',
      'wallets',
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
    wallets = new WalletsService(ds.getRepository(Wallet), ds, ledger);
    escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );
    payments = new PaymentsService(
      ds.getRepository(Payment),
      ds.getRepository(Order),
      ds.getRepository(User),
      wallets,
      escrows,
      ds,
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

  /** Một đơn PAYOS chưa trả tiền, kèm đúng một món của `sellerId`. */
  async function taoDonChuaTra(): Promise<number> {
    const code = `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, shipping_fee, final_amount,
         status, payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, ?, ?, 'pending', 'payos', 0, 'T', '0900000000', 'addr')`,
      [code, buyerId, TIEN_HANG, PHI_SHIP, TIEN_HANG + PHI_SHIP],
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

  const nguoiMua = (): IUser => ({
    id: buyerId,
    full_name: 'buyer',
    email: 'buyer@t.local',
    role: UserRole.BUYER,
    avatar: '',
  });

  const soDu = (
    ownerType: LedgerOwnerType,
    id: number | null,
    p: LedgerPurpose,
  ) => ledger.getBalance(ownerType, id, p);

  /**
   * TC-P0-01 — BUG-01.
   *
   * `PATCH /payments/:id` chỉ có `JwtAuthGuard`, và `PaymentsService.findOne`
   * cho phép chủ sở hữu bản ghi nạp nó. Người mua là chủ payment của chính
   * mình, nên họ tự đặt `status = success` được — và nhánh cuối `update()` ghi
   * thẳng `orders.is_paid = 1`.
   *
   * Không một bút toán nào được sinh ra. Đơn "đã thanh toán" mà sổ cái trống.
   */
  it('TC-P0-01 — người mua KHÔNG tự đặt payment sang success được', async () => {
    const orderId = await taoDonChuaTra();
    const payment = await ds.getRepository(Payment).save(
      ds.getRepository(Payment).create({
        order: { id: orderId },
        user: { id: buyerId },
        amount: TIEN_HANG + PHI_SHIP,
        payment_method: PaymentMethod.PAYOS,
        status: PaymentStatus.PENDING,
        type: PaymentType.ORDER_PAYMENT,
      }),
    );

    await expect(
      payments.update(
        payment.id,
        { status: PaymentStatus.SUCCESS },
        nguoiMua(),
      ),
    ).rejects.toThrow();

    const [don] = await ds.query<Array<{ is_paid: number }>>(
      `SELECT is_paid FROM orders WHERE id = ?`,
      [orderId],
    );
    expect(Number(don.is_paid)).toBe(0);

    // Và sổ cái phải trống: không có đồng nào chạy đi đâu cả.
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      `SELECT COUNT(*) AS n FROM ledger_transactions`,
    );
    expect(Number(n)).toBe(0);
  });

  /**
   * TC-P0-03a — BUG-03.
   *
   * Trả đơn bằng ví: `processOrderPayment` trừ ví vào `escrow_hold` rồi đánh
   * dấu `is_paid`. Nhưng KHÔNG gọi `createOrderEscrows` — đường PayOS có gọi
   * (`payos.service.ts:617`), đường ví thì không.
   *
   * Không có bản ghi ký quỹ nghĩa là `release()` về sau không tìm thấy gì để
   * giải ngân: người bán không bao giờ nhận được tiền của đơn này.
   */
  it('TC-P0-03a — trả bằng ví thì phải sinh ký quỹ cho người bán', async () => {
    const orderId = await taoDonChuaTra();
    await napVi(buyerId, TIEN_HANG + PHI_SHIP);

    await payments.create(
      { order_id: orderId, payment_method: PaymentMethod.WALLET },
      nguoiMua(),
    );

    const rows = await ds.getRepository(Escrow).find({
      where: { order: { id: orderId } },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((e) => e.status === EscrowStatus.HOLDING)).toBe(true);
  });

  /**
   * TC-P0-03b — BUG-03, mặt nguy hiểm hơn.
   *
   * Tiền người mua ĐÃ rời ví và nằm trong `escrow_hold`. Nhưng vì không có bản
   * ghi ký quỹ nào, `refund()` ném `NotFoundException` — mà `applyCancellation`
   * (`orders.service.ts:1143-1149`) NUỐT đúng ngoại lệ đó rồi vẫn huỷ đơn.
   *
   * Kết quả: đơn huỷ, hàng về kho, tiền người mua kẹt trong `escrow_hold`
   * vĩnh viễn. Đây đúng con bug mà `tasks.service.ts` tuyên bố đã diệt.
   */
  it('TC-P0-03b — huỷ đơn trả bằng ví thì tiền phải hoàn được về ví', async () => {
    const orderId = await taoDonChuaTra();
    await napVi(buyerId, TIEN_HANG + PHI_SHIP);

    await payments.create(
      { order_id: orderId, payment_method: PaymentMethod.WALLET },
      nguoiMua(),
    );

    const truoc = await soDu(
      LedgerOwnerType.USER,
      buyerId,
      LedgerPurpose.AVAILABLE,
    );
    expect(truoc).toBe(0n); // toàn bộ tiền đã sang escrow_hold

    // Đây chính là lời gọi mà `applyCancellation` thực hiện khi huỷ đơn đã trả.
    await expect(escrows.refund(orderId)).resolves.toBeDefined();

    const sau = await soDu(
      LedgerOwnerType.USER,
      buyerId,
      LedgerPurpose.AVAILABLE,
    );
    expect(sau).toBe(BigInt(TIEN_HANG + PHI_SHIP));
  });

  /** Nạp ví bằng đúng đường sổ cái (gateway -> available), như webhook topup. */
  async function napVi(userId: number, amount: number) {
    const gw = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    const avl = await ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      userId,
      LedgerPurpose.AVAILABLE,
    );
    await ledger.post({
      idempotencyKey: `test_topup:${userId}:${amount}:${Date.now()}`,
      type: LedgerTxType.TOPUP,
      entries: [
        { accountId: Number(gw.id), amount: -BigInt(amount) },
        { accountId: Number(avl.id), amount: BigInt(amount) },
      ],
    });
  }

  /** Giữ import OrderStatus khỏi bị coi là thừa — dùng ở assert trạng thái đơn. */
  it('TC-P0-03c — trả bằng ví thì đơn phải chuyển sang confirmed', async () => {
    const orderId = await taoDonChuaTra();
    await napVi(buyerId, TIEN_HANG + PHI_SHIP);

    await payments.create(
      { order_id: orderId, payment_method: PaymentMethod.WALLET },
      nguoiMua(),
    );

    const [don] = await ds.query<Array<{ status: string }>>(
      `SELECT status FROM orders WHERE id = ?`,
      [orderId],
    );
    expect(don.status).toBe(OrderStatus.CONFIRMED);
  });
});
