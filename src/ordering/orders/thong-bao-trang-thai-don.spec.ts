import { DataSource, Repository } from 'typeorm';
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
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { PayosService } from '@money/payos/payos.service';
import { ShipmentTrackingService } from './shipment-tracking.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
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
import { StockEventsService } from '@catalog/stock/stock-events.service';

/**
 * BÀI KIỂM ĐỎ: đơn đổi trạng thái thì người liên quan phải được báo.
 *
 * Tới 27/10 chỉ có bốn chỗ gửi thông báo đơn hàng: đặt hàng (người mua), đơn
 * mới (người bán), người bán bị khoá, và tiền về. `updateStatus`, ba đường huỷ
 * và lượt theo dõi GHN không gửi gì: người mua không biết đơn đã được xác nhận,
 * đang giao hay đã bị huỷ trừ khi tự mở app ra xem; người bán không biết người
 * mua vừa huỷ đơn họ đang đóng gói.
 *
 * Mọi lời gọi là lời gọi THẬT vào service, trên MySQL thật. Chỉ kênh thông báo
 * là giả: nó ghi lại thứ được gửi, để bài kiểm hỏi "ai nhận, nói gì".
 *
 * Harness chép từ `dua-trang-thai-don.spec.ts`.
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

interface DaGui {
  user_id: number;
  type: string;
  title: string;
  content: string;
  data?: Record<string, unknown>;
}

describe('Thông báo khi đơn đổi trạng thái', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let escrows: EscrowsService;
  let shipRepo: Repository<OrderShipment>;

  let buyerId: number;
  let sellerId: number;
  let adminId: number;
  let categoryId: number;
  let productId: number;

  /** Mọi thông báo service gửi đi, theo thứ tự. */
  let daGui: DaGui[];
  /** Bật lên thì kênh thông báo ném lỗi như Firebase/MySQL chập. */
  let kenhHong: boolean;
  let ghnTraVe: string;

  const kenh = {
    create: (dto: DaGui) => {
      if (kenhHong) return Promise.reject(new Error('FCM sập'));
      daGui.push(dto);
      return Promise.resolve(undefined);
    },
  };

  const GIA = 100_000;

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
    shipRepo = ds.getRepository(OrderShipment);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    daGui = [];
    kenhHong = false;
    ghnTraVe = 'picked';

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
    sellerId = await taoUser('seller@t.local', UserRole.SELLER);
    adminId = await taoUser('admin@t.local', UserRole.ADMIN);

    await ds.query(
      `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat')`,
    );
    const [cat] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    categoryId = cat.id;
    productId = await taoSanPham('Mon hang', 50);

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

    const ghn = {
      calculateFee: () => Promise.resolve({ total: 0 }),
      createOrder: () => Promise.resolve({ order_code: `GHN-${Date.now()}` }),
      getOrderStatus: () => Promise.resolve(ghnTraVe),
      cancelOrders: (codes: string[]) =>
        Promise.resolve(
          codes.map((c) => ({ order_code: c, result: true, message: 'OK' })),
        ),
    } as unknown as GhnService;

    orders = new OrdersService(
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      shipRepo,
      ds.getRepository(Shop),
      ds.getRepository(Cart),
      ds.getRepository(Product),
      ds.getRepository(User),
      kenh as unknown as NotificationsService,
      ghn,
      escrows,
      {
        voidOpenLinkForOrder: () => Promise.resolve(false),
      } as unknown as PayosService,
      {
        dongBoTatCa: () => Promise.resolve({ checked: 0, delivered: 0 }),
      } as unknown as ShipmentTrackingService,
      ds,
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
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

  async function taoSanPham(ten: string, kho: number): Promise<number> {
    const slug = `${ten}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      .toLowerCase()
      .replace(/\s+/g, '-');
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ten, slug, GIA, kho, ProductStatus.ACTIVE, categoryId, sellerId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM products WHERE slug = ?`,
      [slug],
    );
    return p.id;
  }

  const ai = (id: number, role: UserRole): IUser => ({
    id,
    full_name: role,
    email: `${role}@t.local`,
    role,
    avatar: '',
  });
  const nguoiMua = () => ai(buyerId, UserRole.BUYER);
  const nguoiBan = () => ai(sellerId, UserRole.SELLER);
  const quanTri = () => ai(adminId, UserRole.ADMIN);

  const donMacDinh = (): CreateOrderDto => ({
    shipping_address: 'so 1 duong A',
    receiver_name: 'Nguoi nhan',
    receiver_phone: '0900000000',
    payment_method: PaymentMethod.COD,
    ghn_district_id: 1442,
    ghn_ward_code: '20101',
  });

  /**
   * Đơn chờ xác nhận, KHÔNG có địa chỉ GHN trên đơn (nên xác nhận không tạo
   * vận đơn và huỷ không phải hỏi GHN). Xoá danh sách đã gửi sau khi tạo: hai
   * thông báo "đặt hàng" và "đơn mới" có từ trước, không phải thứ đang đo.
   */
  async function taoDon(): Promise<number> {
    await ds.query(
      `INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, 1)`,
      [buyerId, productId],
    );
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    await ds.query(
      `UPDATE orders SET ghn_district_id = NULL, ghn_ward_code = NULL WHERE id = ?`,
      [don.id],
    );
    daGui = [];
    return don.id;
  }

  /** Đơn đã trả tiền thật (két giữ hộ có tiền, ký quỹ holding). */
  async function taoDonDaTra(
    status: OrderStatus,
    pttt: PaymentMethod = PaymentMethod.COD,
  ): Promise<number> {
    const id = await taoDon();
    await ds.query(
      `UPDATE orders SET is_paid = 1, status = 'confirmed', payment_method = ? WHERE id = ?`,
      [pttt, id],
    );
    await escrows.createOrderEscrowsWithExternalFunding(id);
    await ds.query(`UPDATE orders SET status = ? WHERE id = ?`, [status, id]);
    daGui = [];
    return id;
  }

  const guiCho = (uid: number) => daGui.filter((g) => g.user_id === uid);

  const trangThai = async (id: number): Promise<string> => {
    const [d] = await ds.query<Array<{ status: string }>>(
      `SELECT status FROM orders WHERE id = ?`,
      [id],
    );
    return d.status;
  };

  /** Mọi thông báo đơn hàng phải đủ để app mở đúng màn: id đơn + màn nào. */
  function kiemDuLieu(g: DaGui, orderId: number, view: 'buyer' | 'seller') {
    expect(g.type).toBe('order_status');
    expect(g.data).toMatchObject({ order_id: orderId, view });
    // Văn bản ngắn, người thật đọc được, không dấu gạch dài.
    expect(g.title.length).toBeLessThanOrEqual(60);
    expect(`${g.title} ${g.content}`).not.toMatch(/—/);
  }

  // ── updateStatus ─────────────────────────────────────────────────────────
  it('người bán xác nhận → người mua được báo', async () => {
    const id = await taoDon();
    await orders.updateStatus(
      id,
      { status: OrderStatus.CONFIRMED },
      nguoiBan(),
    );

    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'buyer');
    expect(g[0].title).toMatch(/xác nhận/i);
    expect(guiCho(sellerId)).toHaveLength(0);
  });

  it('kênh thông báo hỏng thì đổi trạng thái VẪN thành công', async () => {
    const id = await taoDon();
    kenhHong = true;

    await expect(
      orders.updateStatus(id, { status: OrderStatus.CONFIRMED }, nguoiBan()),
    ).resolves.toBeTruthy();
    expect(await trangThai(id)).toBe(OrderStatus.CONFIRMED);
  });

  it('admin chuyển sang Đang giao → người mua được báo', async () => {
    const id = await taoDon();
    await ds.query(`UPDATE orders SET status = 'confirmed' WHERE id = ?`, [id]);

    await orders.updateStatus(id, { status: OrderStatus.SHIPPING }, quanTri());

    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'buyer');
    expect(g[0].title).toMatch(/đang giao/i);
  });

  it('người mua xác nhận đã nhận → báo cả người mua lẫn người bán', async () => {
    const id = await taoDonDaTra(OrderStatus.SHIPPING);

    await orders.updateStatus(
      id,
      { status: OrderStatus.DELIVERED },
      nguoiMua(),
    );

    expect(guiCho(buyerId)).toHaveLength(1);
    kiemDuLieu(guiCho(buyerId)[0], id, 'buyer');
    expect(guiCho(sellerId)).toHaveLength(1);
    kiemDuLieu(guiCho(sellerId)[0], id, 'seller');
  });

  it('hoàn tiền đơn PayOS → người mua được báo tiền về ví', async () => {
    const id = await taoDonDaTra(OrderStatus.DELIVERED, PaymentMethod.PAYOS);

    await orders.updateStatus(id, { status: OrderStatus.REFUNDED }, quanTri());

    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'buyer');
    expect(g[0].content).toMatch(/ví/i);
  });

  it('hoàn tiền đơn COD → báo hoàn tiền, không hứa tiền về ví', async () => {
    const id = await taoDonDaTra(OrderStatus.DELIVERED, PaymentMethod.COD);

    await orders.updateStatus(id, { status: OrderStatus.REFUNDED }, quanTri());

    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    expect(g[0].title).toMatch(/hoàn tiền/i);
    expect(g[0].content).not.toMatch(/ví/i);
  });

  // ── Huỷ ──────────────────────────────────────────────────────────────────
  it('người mua huỷ → người bán được báo, người mua thì không', async () => {
    const id = await taoDon();
    await orders.cancel(id, nguoiMua());

    expect(guiCho(buyerId)).toHaveLength(0);
    const g = guiCho(sellerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'seller');
    expect(g[0].title).toMatch(/huỷ|hủy/i);
  });

  it('người bán huỷ bán → người mua được báo', async () => {
    const id = await taoDon();
    await orders.cancelSale(id, nguoiBan());

    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'buyer');
    expect(guiCho(sellerId)).toHaveLength(0);
  });

  it('admin huỷ → người mua được báo', async () => {
    const id = await taoDon();
    await orders.cancel(id, quanTri());

    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'buyer');
  });

  it('huỷ lần hai (đơn đã huỷ rồi) không báo lại', async () => {
    const id = await taoDon();
    await orders.cancelExpired(id);
    daGui = [];
    // Cron chạy lại trên đơn đã huỷ: bị assertCancellable chặn hoặc no-op.
    await orders.cancelExpired(id).catch(() => undefined);
    expect(daGui).toHaveLength(0);
  });

  it('hệ thống tự huỷ đơn quá hạn → báo cả người mua và người bán', async () => {
    const id = await taoDon();
    await orders.cancelExpired(id);

    expect(guiCho(buyerId)).toHaveLength(1);
    kiemDuLieu(guiCho(buyerId)[0], id, 'buyer');
    expect(guiCho(sellerId)).toHaveLength(1);
    kiemDuLieu(guiCho(sellerId)[0], id, 'seller');
  });

  it('huỷ vì người bán bị khoá → người mua nhận ĐÚNG một thông báo', async () => {
    await taoDon();
    await orders.huyDonChoCuaNguoiBan(sellerId);
    expect(guiCho(buyerId)).toHaveLength(1);
  });

  // ── Người mua chốt từng lô → đơn giao trọn ──────────────────────────────
  it('người mua nhận lô cuối cùng → đơn giao xong, người bán được báo', async () => {
    const id = await taoDonDaTra(OrderStatus.SHIPPING);
    await shipRepo.save(
      shipRepo.create({
        order: { id } as Order,
        seller: { id: sellerId } as User,
        cod_amount: GIA,
        status: ShipmentStatus.DELIVERED,
        delivered_at: new Date(),
      }),
    );

    await orders.confirmShipmentReceived(id, sellerId, nguoiMua());

    expect(await trangThai(id)).toBe(OrderStatus.DELIVERED);
    const g = guiCho(sellerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'seller');
  });

  // ── Theo dõi GHN ─────────────────────────────────────────────────────────
  /**
   * Dựng ShipmentTrackingService với kênh thông báo. Ép kiểu qua constructor
   * tổng quát: lúc bài kiểm này được viết, lớp đó chưa nhận tham số thứ ba, và
   * gọi thẳng `new ShipmentTrackingService(a, b, c)` là lỗi biên dịch, tức bài
   * kiểm đỏ vì TypeScript chứ không vì hành vi.
   */
  function dungTheoDoi(): ShipmentTrackingService {
    const Ctor = ShipmentTrackingService as unknown as new (
      ...a: unknown[]
    ) => ShipmentTrackingService;
    const ghn = { getOrderStatus: () => Promise.resolve(ghnTraVe) };
    return new Ctor(shipRepo, ghn, kenh);
  }

  async function taoLoGhn(id: number): Promise<void> {
    await shipRepo.save(
      shipRepo.create({
        order: { id } as Order,
        seller: { id: sellerId } as User,
        tracking_code: `GHN-${id}`,
        cod_amount: GIA,
        status: ShipmentStatus.CREATED,
      }),
    );
  }

  it('GHN lấy hàng → đơn sang Đang giao và người mua được báo', async () => {
    const id = await taoDon();
    await ds.query(`UPDATE orders SET status = 'confirmed' WHERE id = ?`, [id]);
    await taoLoGhn(id);
    ghnTraVe = 'picked';

    await dungTheoDoi().dongBoTatCa();

    expect(await trangThai(id)).toBe(OrderStatus.SHIPPING);
    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'buyer');
  });

  it('GHN giao tới cửa → người mua được nhắc xác nhận đã nhận', async () => {
    const id = await taoDon();
    await ds.query(`UPDATE orders SET status = 'shipping' WHERE id = ?`, [id]);
    await taoLoGhn(id);
    ghnTraVe = 'delivered';

    await dungTheoDoi().dongBoTatCa();

    const g = guiCho(buyerId);
    expect(g).toHaveLength(1);
    kiemDuLieu(g[0], id, 'buyer');
    expect(g[0].content).toMatch(/đã nhận/i);
  });

  it('kênh hỏng thì lượt đồng bộ GHN vẫn ghi đúng trạng thái', async () => {
    const id = await taoDon();
    await ds.query(`UPDATE orders SET status = 'confirmed' WHERE id = ?`, [id]);
    await taoLoGhn(id);
    ghnTraVe = 'delivered';
    kenhHong = true;

    await dungTheoDoi().dongBoTatCa();

    expect(await trangThai(id)).toBe(OrderStatus.SHIPPING);
    const [lo] = await shipRepo.find({ where: { order: { id } } });
    expect(lo.status).toBe(ShipmentStatus.DELIVERED);
  });

  // ── Review 27/10 (E): GHN báo "cancel" vì CHÍNH mình vừa huỷ vận đơn ─────
  //
  // `huyVanDonGhnTruoc` gọi GHN huỷ rồi mới đánh dấu lô FAILED, hai bước rời.
  // GHN đẩy webhook "cancel" (hay lượt quét chạy) đúng vào khe đó thì lô vẫn
  // CREATED, đơn vẫn chưa huỷ, và mọi admin nhận "Vận đơn GHN gặp sự cố" cho
  // một việc chính hệ thống vừa làm.
  const choAdmin = () =>
    daGui.filter((g) => g.user_id === adminId && g.type === 'system');

  it('GHN báo cancel giữa lúc mình đang huỷ vận đơn → không báo admin', async () => {
    const id = await taoDon();
    await ds.query(`UPDATE orders SET status = 'confirmed' WHERE id = ?`, [id]);
    await taoLoGhn(id);
    ghnTraVe = 'cancel';
    const theoDoi = dungTheoDoi();
    // GHN nhận lệnh huỷ, và lượt đồng bộ chạy ĐÚNG lúc GHN vừa trả lời.
    (orders as unknown as { ghnService: unknown }).ghnService = {
      cancelOrders: async (codes: string[]) => {
        await theoDoi.dongBoTatCa();
        return codes.map((c) => ({
          order_code: c,
          result: true,
          message: 'OK',
        }));
      },
    };

    await orders.cancel(id, nguoiMua());

    expect(await trangThai(id)).toBe(OrderStatus.CANCELLED);
    expect(choAdmin()).toHaveLength(0);
  });

  it('đơn đã huỷ mà lô còn sót CREATED, GHN báo cancel → không báo admin', async () => {
    const id = await taoDon();
    await ds.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [id]);
    await taoLoGhn(id);
    ghnTraVe = 'cancel';

    await dungTheoDoi().dongBoTatCa();

    expect(choAdmin()).toHaveLength(0);
  });

  it('GHN tự huỷ vận đơn của đơn đang sống → VẪN báo admin', async () => {
    const id = await taoDon();
    await ds.query(`UPDATE orders SET status = 'confirmed' WHERE id = ?`, [id]);
    await taoLoGhn(id);
    ghnTraVe = 'cancel';

    await dungTheoDoi().dongBoTatCa();

    expect(choAdmin()).toHaveLength(1);
  });
});
