import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  OrderShipment,
  ShipmentStatus,
} from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { GhnService } from '@ordering/ghn/ghn.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow, EscrowStatus } from '@money/escrows/entities/escrow.entity';
import { PayosService } from '@money/payos/payos.service';
import { ShipmentTrackingService } from './shipment-tracking.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { LedgerOwnerType, LedgerPurpose } from '@money/ledger/ledger.types';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ — đơn C2C nhiều người bán, và đường giải ngân theo từng lô.
 *
 * Đây là phần non nhất của luồng tiền: `confirmShipmentReceived` nhả tiền theo
 * TỪNG người bán, nhưng `cancelSale` và `applyCancellation` vẫn làm việc theo
 * CẢ ĐƠN. Hai cách nhìn khác nhau về cùng một đơn hàng, và không chỗ nào hoà
 * giải chúng.
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

jest.setTimeout(120_000);

describe('Đơn nhiều người bán — giải ngân và huỷ', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let escrows: EscrowsService;
  let ledger: LedgerService;

  let buyerId: number;
  let sellerAId: number;
  let sellerBId: number;
  let categoryId: number;
  let hangA: number;
  let hangB: number;

  const GIA = 100_000;
  const KHO = 20;

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
      'order_shipments',
      'order_items',
      'orders',
      'carts',
      'products',
      'follows',
      'shops',
      'categories',
      'users',
      'settings',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    buyerId = await taoUser('buyer@t.local', UserRole.BUYER);
    sellerAId = await taoUser('sellerA@t.local', UserRole.SELLER);
    sellerBId = await taoUser('sellerB@t.local', UserRole.SELLER);

    await ds.query(
      `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat')`,
    );
    const [cat] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    categoryId = cat.id;

    hangA = await taoSanPham('Hang cua A', sellerAId);
    hangB = await taoSanPham('Hang cua B', sellerBId);

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

    const ghn = {
      calculateFee: () => Promise.resolve({ total: 0 }),
      createOrder: () => Promise.resolve({ order_code: `GHN-${Date.now()}` }),
      getOrderStatus: () => Promise.resolve('delivered'),
    } as unknown as GhnService;

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
      ghn,
      escrows,
      {
        voidOpenLinkForOrder: () => Promise.resolve(false),
      } as unknown as PayosService,
      {
        dongBoTatCa: () => Promise.resolve({ checked: 0, delivered: 0 }),
      } as unknown as ShipmentTrackingService,
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

  async function taoSanPham(ten: string, chu: number): Promise<number> {
    const slug = `${ten}-${Math.floor(Math.random() * 1e9)}`
      .toLowerCase()
      .replace(/\s+/g, '-');
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ten, slug, GIA, KHO, ProductStatus.ACTIVE, categoryId, chu],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM products WHERE slug = ?`,
      [slug],
    );
    return p.id;
  }

  async function themVaoGio(pid: number, qty: number) {
    await ds.query(
      `INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = ?`,
      [buyerId, pid, qty, qty],
    );
  }

  const nguoiMua = (): IUser => ({
    id: buyerId,
    full_name: 'buyer',
    email: 'buyer@t.local',
    role: UserRole.BUYER,
    avatar: '',
  });

  const nguoiBan = (id: number, email: string): IUser => ({
    id,
    full_name: 'seller',
    email,
    role: UserRole.SELLER,
    avatar: '',
  });

  const donMacDinh = (): CreateOrderDto => ({
    shipping_address: 'so 1 duong A',
    receiver_name: 'Nguoi nhan',
    receiver_phone: '0900000000',
    payment_method: PaymentMethod.COD,
  });

  const khoCua = async (pid: number): Promise<number> => {
    const [p] = await ds.query<Array<{ stock: number }>>(
      `SELECT stock FROM products WHERE id = ?`,
      [pid],
    );
    return Number(p.stock);
  };

  const ketGiuHo = () =>
    ledger.getBalance(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

  const viCua = (id: number) =>
    ledger.getBalance(LedgerOwnerType.USER, id, LedgerPurpose.AVAILABLE);

  /** Đơn gồm 1 món của A và 1 món của B. */
  async function taoDonHaiNguoiBan(): Promise<number> {
    await themVaoGio(hangA, 1);
    await themVaoGio(hangB, 1);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    return don.id;
  }

  /** Lô hàng đã tạo vận đơn cho một người bán — như sau khi người bán xác nhận. */
  async function taoLo(orderId: number, sellerId: number) {
    const repo = ds.getRepository(OrderShipment);
    await repo.save(
      repo.create({
        order: { id: orderId } as Order,
        seller: { id: sellerId } as User,
        tracking_code: `GHN-${orderId}-${sellerId}`,
        cod_amount: GIA,
        status: ShipmentStatus.CREATED,
      }),
    );
  }

  /**
   * TC-P0-05b — BUG-05.
   *
   * Đơn COD. Admin bấm "đã thanh toán" (`updateStatus({is_paid:true})`) →
   * `createOrderEscrows` sinh khoản ký quỹ. Nhưng KHÔNG có bút toán nào nạp
   * tiền vào `escrow_hold`: tiền COD do GHN thu, và không đường nào trong
   * `src/money` ghi nhận nó.
   *
   * Người mua bấm đã nhận → `release()` rút từ két rỗng → két âm.
   */
  it('TC-P0-05b — đơn COD không được làm két giữ hộ âm', async () => {
    await themVaoGio(hangA, 1);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;

    const admin = {
      id: 999,
      full_name: 'admin',
      email: 'a@t.local',
      role: UserRole.ADMIN,
      avatar: '',
    } as IUser;
    await orders.updateStatus(don.id, { is_paid: true }, admin);

    await taoLo(don.id, sellerAId);
    await orders.confirmShipmentReceived(don.id, sellerAId, nguoiMua());

    expect(await ketGiuHo()).toBeGreaterThanOrEqual(0n);
  });

  /**
   * TC-P1-09a — BUG-09.
   *
   * `cancelSale` nhận `sellerId` chỉ để KIỂM QUYỀN, rồi gọi thẳng
   * `applyCancellation(order)` — hàm này huỷ cả đơn, hoàn kho MỌI món và
   * refund MỌI khoản ký quỹ đang giữ.
   *
   * Người bán A bấm "huỷ bán" phần của mình là huỷ luôn phần của B, trong khi
   * B chưa làm gì sai và có thể đã đóng gói xong.
   */
  it('TC-P1-09a — người bán A không huỷ được phần hàng của người bán B', async () => {
    const orderId = await taoDonHaiNguoiBan();
    expect(await khoCua(hangB)).toBe(KHO - 1);

    // Bị TỪ CHỐI: huỷ đơn này sẽ đụng vào phần của người bán B.
    await expect(
      orders.cancelSale(orderId, nguoiBan(sellerAId, 'sellerA@t.local')),
    ).rejects.toThrow();

    // Hàng của B phải vẫn đang bán dở, không được trả về kho.
    expect(await khoCua(hangB)).toBe(KHO - 1);

    // Và đơn vẫn sống — không bị huỷ sau lưng người bán B.
    const [don] = await ds.query<Array<{ status: string }>>(
      `SELECT status FROM orders WHERE id = ?`,
      [orderId],
    );
    expect(don.status).not.toBe(OrderStatus.CANCELLED);
  });

  /**
   * TC-P1-09b — BUG-09, mặt tồn kho.
   *
   * Người mua đã nhận hàng của A và tiền của A đã giải ngân (`released`).
   * Sau đó đơn bị huỷ vì phần của B — `applyCancellation` cộng lại kho cho
   * CẢ hàng của A, món mà người mua đang cầm trong tay.
   *
   * Kho phình ra một món không có thật, và người sau đặt được thứ không tồn tại.
   */
  it('TC-P1-09b — không hoàn kho món đã giao và đã giải ngân', async () => {
    const orderId = await taoDonHaiNguoiBan();

    // Giả lập đơn đã trả tiền để có khoản ký quỹ thật.
    await ds.query(`UPDATE orders SET is_paid = 1 WHERE id = ?`, [orderId]);
    await escrows.createOrderEscrows(orderId);

    // Cả HAI lô đều phải tồn tại. Chỉ tạo lô của A thì sau khi nhận hàng
    // `reconcileOrderDelivered` thấy "mọi lô đã nhận" và đặt đơn sang
    // `delivered` — lúc đó `cancel` bị chặn ngay ở `assertCancellable` và bài
    // kiểm sẽ xanh vì một lý do không liên quan gì tới lỗi đang đo.
    await taoLo(orderId, sellerAId);
    await taoLo(orderId, sellerBId);
    await orders.confirmShipmentReceived(orderId, sellerAId, nguoiMua());

    const daGiaiNgan = await ds.getRepository(Escrow).find({
      where: { order: { id: orderId }, status: EscrowStatus.RELEASED },
    });
    expect(daGiaiNgan).toHaveLength(1);

    const khoATruoc = await khoCua(hangA);
    await orders.cancel(orderId, nguoiMua()).catch(() => undefined);

    expect(await khoCua(hangA)).toBe(khoATruoc);
  });

  /**
   * TC-P2-17 — BUG-17.
   *
   * Người mua xác nhận từng lô → mọi khoản ký quỹ đã `released`. Sau đó ai đó
   * (người bán, admin, hay chính giao diện cũ) gọi
   * `PATCH /orders/:id/status {delivered}` → `release(orderId)` không còn khoản
   * `holding` nào → ném `NotFoundException` → API trả 400.
   *
   * Không có gì sai đã xảy ra, nhưng người dùng nhận một thông báo lỗi về tiền.
   */
  it('TC-P2-17 — đặt delivered sau khi đã xác nhận từng lô không được báo lỗi', async () => {
    await themVaoGio(hangA, 1);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    await ds.query(`UPDATE orders SET is_paid = 1 WHERE id = ?`, [don.id]);
    await escrows.createOrderEscrows(don.id);

    await taoLo(don.id, sellerAId);
    await orders.confirmShipmentReceived(don.id, sellerAId, nguoiMua());

    await ds.query(`UPDATE orders SET status = ? WHERE id = ?`, [
      OrderStatus.SHIPPING,
      don.id,
    ]);

    await expect(
      orders.updateStatus(
        don.id,
        { status: OrderStatus.DELIVERED },
        nguoiMua(),
      ),
    ).resolves.toBeDefined();
  });

  /**
   * TC-P3-20 — BUG-20.
   *
   * `confirmShipmentReceived` kiểm: người gọi có phải người mua, lô có tồn tại,
   * lô đã RECEIVED chưa, lô có FAILED không. Nó KHÔNG kiểm `order.is_paid`.
   *
   * Ghép với BUG-02 (ký quỹ sinh ra lúc tạo link, chưa trả tiền) thì đây là
   * nút bấm cuối cùng của chuỗi lấy hàng miễn phí.
   */
  it('TC-P3-20 — không xác nhận nhận hàng khi đơn chưa thanh toán', async () => {
    await themVaoGio(hangA, 1);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    // KHÔNG đặt is_paid. Thử tạo ký quỹ như `payos.controller.ts` từng làm ngay
    // lúc tạo link thanh toán — nay bị `createOrderEscrows` từ chối (BUG-02 đã
    // vá), nên lời gọi này được phép ném.
    //
    // Bài kiểm vẫn giữ nguyên ý nghĩa: dù ký quỹ có tồn tại hay không, người
    // mua KHÔNG được xác nhận nhận hàng trên một đơn chưa thanh toán.
    await escrows.createOrderEscrows(don.id).catch(() => undefined);
    await taoLo(don.id, sellerAId);

    await expect(
      orders.confirmShipmentReceived(don.id, sellerAId, nguoiMua()),
    ).rejects.toThrow();

    expect(await viCua(sellerAId)).toBe(0n);
  });
});
