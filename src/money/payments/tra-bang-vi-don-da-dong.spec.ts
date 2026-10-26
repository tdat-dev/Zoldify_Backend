import { NotFoundException } from '@nestjs/common';
import { DataSource, FindOneOptions } from 'typeorm';
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
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { PayosService } from '@money/payos/payos.service';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ: trả bằng ví cho một đơn không còn nhận tiền.
 *
 * `processOrderPayment` chỉ hỏi "đơn của bạn không" và "đã trả chưa", rồi đặt
 * thẳng `confirmed`. Đơn đã huỷ (hàng đã về kho) trả bằng ví được, và SỐNG
 * LẠI: người bán phải giao một món mà kho đã bán cho người khác.
 *
 * Harness chép từ `tu-danh-dau-da-tra-tien.spec.ts`.
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

describe('PaymentsService: trả bằng ví cho đơn đã đóng', () => {
  let ds: DataSource;
  let payments: PaymentsService;
  let ledger: LedgerService;
  let dongLink: jest.Mock;

  let buyerId: number;
  let sellerId: number;
  let productId: number;

  const TIEN_HANG = 500_000;

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
    const wallets = new WalletsService(ds.getRepository(Wallet), ds, ledger);
    const escrows = new EscrowsService(
      ds.getRepository(Escrow),
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds,
      ledger,
      new PlatformFeeService(ds),
    );

    dongLink = jest.fn(() => Promise.resolve(true));
    payments = new PaymentsService(
      ds.getRepository(Payment),
      ds.getRepository(Order),
      ds.getRepository(User),
      wallets,
      escrows,
      ds,
      { voidOpenLinkForOrder: dongLink } as unknown as PayosService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

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

  async function taoDonChuaTra(status: OrderStatus): Promise<number> {
    const code = `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, total_amount, shipping_fee, final_amount,
         status, payment_method, is_paid, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, 0, ?, ?, 'payos', 0, 'T', '0900000000', 'addr')`,
      [code, buyerId, TIEN_HANG, TIEN_HANG, status],
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

  const nguoiMua = (): IUser => ({
    id: buyerId,
    full_name: 'buyer',
    email: 'buyer@t.local',
    role: UserRole.BUYER,
    avatar: '',
  });

  const viNguoiMua = () =>
    ledger.getBalance(LedgerOwnerType.USER, buyerId, LedgerPurpose.AVAILABLE);

  const donLuc = async (id: number) => {
    const [d] = await ds.query<Array<{ status: string; is_paid: number }>>(
      `SELECT status, is_paid FROM orders WHERE id = ?`,
      [id],
    );
    return { status: d.status, is_paid: Number(d.is_paid) };
  };

  const traBangVi = (orderId: number) =>
    payments.create(
      { order_id: orderId, payment_method: PaymentMethod.WALLET },
      nguoiMua(),
    );

  it('D: đơn đã huỷ không trả bằng ví được, đơn không sống lại', async () => {
    const orderId = await taoDonChuaTra(OrderStatus.CANCELLED);
    await napVi(buyerId, TIEN_HANG);

    await expect(traBangVi(orderId)).rejects.toThrow();

    expect(await donLuc(orderId)).toEqual({
      status: OrderStatus.CANCELLED,
      is_paid: 0,
    });
    expect(await viNguoiMua()).toBe(BigInt(TIEN_HANG));
  });

  /**
   * D, mặt đua: huỷ commit ngay SAU khi `processOrderPayment` đọc đơn (đơn
   * còn `pending`, qua được mọi phép kiểm), TRƯỚC khi nó trừ ví.
   *
   * Kiểm trên bản đọc cũ thì cửa sổ này không bao giờ đóng được, dù có thêm
   * bao nhiêu phép kiểm trạng thái đi nữa.
   */
  it('D: huỷ chen giữa lúc trả bằng ví thì không trừ ví, đơn vẫn huỷ', async () => {
    const orderId = await taoDonChuaTra(OrderStatus.PENDING);
    await napVi(buyerId, TIEN_HANG);

    const repo = ds.getRepository(Order);
    const goc = repo.findOne.bind(repo) as (
      o: FindOneOptions<Order>,
    ) => Promise<Order | null>;
    jest
      .spyOn(repo, 'findOne')
      .mockImplementationOnce(async (opts: FindOneOptions<Order>) => {
        const don = await goc(opts);
        await ds.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [
          orderId,
        ]);
        return don;
      });

    await expect(traBangVi(orderId)).rejects.toThrow();

    expect(await donLuc(orderId)).toEqual({
      status: OrderStatus.CANCELLED,
      is_paid: 0,
    });
    expect(await viNguoiMua()).toBe(BigInt(TIEN_HANG));
  });

  /**
   * D. Trả bằng ví xong mà link PayOS cũ vẫn mở: người mua quét nốt mã QR là
   * trả lần hai. Webhook đã có lưới đỡ (tiền vào ví), nhưng đóng link ngay từ
   * đầu thì khỏi phải đỡ.
   */
  it('D: trả bằng ví xong thì đóng link PayOS còn treo của đơn', async () => {
    const orderId = await taoDonChuaTra(OrderStatus.PENDING);
    await napVi(buyerId, TIEN_HANG);

    await traBangVi(orderId);

    expect(dongLink).toHaveBeenCalledWith(orderId);
  });

  /**
   * Đếm số khoản ký quỹ của đơn ĐÚNG LÚC bút toán ORDER_HOLD đầu tiên được
   * ghi, đọc qua chính transaction đang ghi (thấy cả dòng chưa commit).
   *
   * Review 3: huỷ/giải ngân khoá ký quỹ RỒI mới ghi sổ, còn các đường trả
   * tiền ghi sổ (khoá két giữ hộ) RỒI mới chèn ký quỹ. Hai thứ tự ngược nhau
   * trên cùng hai tài nguyên là công thức của deadlock 1213. Thứ tự chung
   * phải là đơn, rồi ký quỹ, rồi sổ cái; nên lúc ghi sổ, ký quỹ phải có rồi.
   */
  function demKyQuyLucGhiSo(orderId: number): () => number | undefined {
    let dem: number | undefined;
    const goc = ledger.post.bind(ledger) as LedgerService['post'];
    jest.spyOn(ledger, 'post').mockImplementation(async (input, em) => {
      if (dem === undefined && input.type === LedgerTxType.ORDER_HOLD && em) {
        const r = (await em.query(
          'SELECT COUNT(*) AS n FROM escrows WHERE order_id = ?',
          [orderId],
        )) as Array<{ n: number | string }>;
        dem = Number(r[0].n);
      }
      return goc(input, em);
    });
    return () => dem;
  }

  it('review 3: trả bằng ví thì chèn ký quỹ trước khi trừ ví', async () => {
    const orderId = await taoDonChuaTra(OrderStatus.PENDING);
    await napVi(buyerId, TIEN_HANG);
    const dem = demKyQuyLucGhiSo(orderId);

    await traBangVi(orderId);

    expect(dem()).toBe(1);
  });

  /**
   * Review 4: \`deduct(..., em)\` kết thúc bằng \`this.getBalance(userId)\`, mà
   * hàm đó đọc bằng \`dataSource.manager\` với HAI câu song song. Đang giữ một
   * kết nối cho transaction, nó mượn thêm hai kết nối nữa từ pool (giới hạn
   * 15): đủ người trả bằng ví cùng lúc là pool tự cạn, mọi request treo chờ
   * kết nối mà chính chúng đang giữ. Người gọi duy nhất còn bỏ qua kết quả.
   */
  it('review 4: trả bằng ví không mượn thêm kết nối để đọc số dư', async () => {
    const orderId = await taoDonChuaTra(OrderStatus.PENDING);
    await napVi(buyerId, TIEN_HANG);
    const docSoDu = jest.spyOn(WalletsService.prototype, 'getBalance');

    await traBangVi(orderId);

    expect(docSoDu).not.toHaveBeenCalled();
  });

  /**
   * Review 7: bản vá D đòi đơn phải \`pending\`, nên đơn đã được người bán xác
   * nhận mà chưa trả tiền (vd COD đổi ý trả bằng ví) không trả bằng ví được
   * nữa, trong khi PayOS vẫn nhận tiền cho đúng đơn đó. Hai cổng tiền phải
   * cùng một luật. Trả xong thì đơn giữ nguyên \`confirmed\`.
   */
  it('review 7: đơn đã xác nhận chưa trả tiền thì trả bằng ví được', async () => {
    const orderId = await taoDonChuaTra(OrderStatus.CONFIRMED);
    await napVi(buyerId, TIEN_HANG);

    await traBangVi(orderId);

    expect(await donLuc(orderId)).toEqual({
      status: OrderStatus.CONFIRMED,
      is_paid: 1,
    });
    expect(await viNguoiMua()).toBe(0n);
  });

  /**
   * Review 7: đơn biến mất giữa lúc đọc và lúc khoá thì báo "không tìm thấy",
   * không báo "đã được thanh toán" (câu đó làm người mua tưởng tiền đã đi).
   */
  it('review 7: đơn biến mất giữa chừng thì báo không tìm thấy', async () => {
    const orderId = await taoDonChuaTra(OrderStatus.PENDING);
    await napVi(buyerId, TIEN_HANG);

    const repo = ds.getRepository(Order);
    const goc = repo.findOne.bind(repo) as (
      o: FindOneOptions<Order>,
    ) => Promise<Order | null>;
    jest
      .spyOn(repo, 'findOne')
      .mockImplementationOnce(async (opts: FindOneOptions<Order>) => {
        const don = await goc(opts);
        await ds.query('UPDATE orders SET deleted_at = NOW() WHERE id = ?', [
          orderId,
        ]);
        return don;
      });

    await expect(traBangVi(orderId)).rejects.toBeInstanceOf(NotFoundException);
    expect(await viNguoiMua()).toBe(BigInt(TIEN_HANG));
  });
});
