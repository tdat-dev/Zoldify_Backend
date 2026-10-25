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
import { Escrow } from '@money/escrows/entities/escrow.entity';
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
import { StockEventsService } from '@catalog/stock/stock-events.service';

/**
 * BÀI KIỂM ĐỎ: hai thao tác cùng chạm một đơn, cùng lúc.
 *
 * Các spec khác đo từng thao tác một mình. File này đo đúng chỗ chúng giẫm
 * lên nhau: người mua bấm "đã nhận" và "huỷ" cùng lúc, người bán xác nhận đơn
 * trong lúc người mua huỷ, webhook tiền về giữa chừng một lần đổi trạng thái.
 *
 * Mọi lời gọi là lời gọi THẬT vào service, trên MySQL thật. Chỗ nào cần ép
 * xen kẽ thì chen vào đúng một điểm (stub GHN, hoặc điểm hẹn trên sổ cái),
 * không chép lại trình tự SQL: bài kiểm R1/R4 từng chép SQL và sửa mã xong vẫn
 * đỏ y nguyên (docs/BAN-GIAO.md, mục 1).
 *
 * Harness chép từ `dat-hang-va-ton-kho.spec.ts`.
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

/**
 * Điểm hẹn: lượt nào tới trước thì đứng chờ lượt kia, tối đa `ms`.
 *
 * Đủ `soLuot` lượt thì cả nhóm cùng đi. Không đủ (lượt kia đang bị khoá dòng
 * chặn lại, tức là bản vá đang làm đúng việc) thì hết `ms` tự đi một mình,
 * không treo bài kiểm.
 */
function diemHen(soLuot: number, ms: number): () => Promise<void> {
  let den = 0;
  let mo: () => void = () => undefined;
  const duNguoi = new Promise<void>((r) => (mo = r));
  return async () => {
    den += 1;
    if (den >= soLuot) mo();
    let hen: NodeJS.Timeout | undefined;
    await Promise.race([
      duNguoi,
      new Promise((r) => (hen = setTimeout(r, ms))),
    ]);
    clearTimeout(hen);
  };
}

describe('Đua trạng thái đơn và ký quỹ', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let escrows: EscrowsService;
  let ledger: LedgerService;

  let buyerId: number;
  let sellerId: number;
  let categoryId: number;
  let productId: number;

  const GIA = 100_000;
  const KHO_BAN_DAU = 50;

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
    sellerId = await taoUser('seller@t.local', UserRole.SELLER);

    await ds.query(
      `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat')`,
    );
    const [cat] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    categoryId = cat.id;
    productId = await taoSanPham('Mon hang', KHO_BAN_DAU);

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

    // Phát tồn kho: không đo ở đây (xem `dat-hang-va-ton-kho.spec.ts`).
    const khoPhat = {
      phat: () => Promise.resolve(),
    } as unknown as StockEventsService;

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
      khoPhat,
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

  async function themVaoGio(pid: number, qty: number): Promise<void> {
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

  const donMacDinh = (): CreateOrderDto => ({
    shipping_address: 'so 1 duong A',
    receiver_name: 'Nguoi nhan',
    receiver_phone: '0900000000',
    payment_method: PaymentMethod.COD,
  });

  const ketGiuHo = () =>
    ledger.getBalance(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

  const viCua = (id: number) =>
    ledger.getBalance(LedgerOwnerType.USER, id, LedgerPurpose.AVAILABLE);

  /**
   * Đơn đã trả tiền thật: két giữ hộ có đúng `final_amount`, một khoản ký quỹ
   * `holding` cho người bán, đơn ở `confirmed`.
   */
  async function taoDonDaTra(soLuong = 1): Promise<number> {
    await themVaoGio(productId, soLuong);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    await ds.query(
      `UPDATE orders SET is_paid = 1, status = 'confirmed' WHERE id = ?`,
      [don.id],
    );
    await escrows.createOrderEscrowsWithExternalFunding(don.id);
    return don.id;
  }

  /**
   * Lô hàng đã tới tay người mua, KHÔNG có mã vận đơn GHN.
   *
   * Cố ý không có mã: đơn có vận đơn GHN đang đi thì nút huỷ bị chặn hẳn từ
   * trước (bài kiểm E bên dưới), và lúc đó cuộc đua "nhận hàng vs huỷ" không
   * còn chạy tới tầng ký quỹ để mà đo. Bỏ mã vận đơn là cách giữ cho bài kiểm
   * này vẫn đo được lớp khoá dòng ký quỹ, lớp phòng thủ cuối cùng.
   */
  async function taoLoDaGiao(orderId: number): Promise<void> {
    const repo = ds.getRepository(OrderShipment);
    await repo.save(
      repo.create({
        order: { id: orderId } as Order,
        seller: { id: sellerId } as User,
        cod_amount: GIA,
        status: ShipmentStatus.DELIVERED,
        delivered_at: new Date(),
      }),
    );
  }

  /**
   * Chen điểm hẹn vào lần ghi sổ cái ĐẦU TIÊN của mỗi bên.
   *
   * `release` và `refund` đều đọc khoản ký quỹ trước, rồi mới gọi
   * `getOrCreateAccount` để chuẩn bị bút toán. Bắt hai lượt gặp nhau ở đó là
   * ép đúng cửa sổ "cả hai đã đọc thấy holding, chưa ai ghi". Ở production
   * cửa sổ này mở ra ngẫu nhiên; ở đây nó mở ra mọi lần.
   */
  function epGapNhauTruocKhiGhiSo(): void {
    const hen = diemHen(2, 1_500);
    const goc = ledger.getOrCreateAccount.bind(ledger) as (
      ...a: Parameters<LedgerService['getOrCreateAccount']>
    ) => ReturnType<LedgerService['getOrCreateAccount']>;
    let soLan = 0;
    jest
      .spyOn(ledger, 'getOrCreateAccount')
      .mockImplementation(async (...a) => {
        if (soLan++ < 2) await hen();
        return goc(...a);
      });
  }

  afterEach(() => jest.restoreAllMocks());

  /**
   * A. "Đã nhận hàng" và "huỷ đơn" bấm cùng lúc.
   *
   * `release` và `refund` đọc khoản ký quỹ bằng `em.find` thường, không khoá.
   * Hai bên cùng thấy `holding`, và vì khoá chống trùng của sổ cái KHÁC nhau
   * (`escrow_release:` và `escrow_refund:`) nên sổ cái không chặn hộ được:
   * người bán nhận tiền VÀ người mua được hoàn tiền, két giữ hộ âm đúng bằng
   * giá trị đơn.
   */
  it('A: nhận hàng và huỷ cùng lúc thì tiền chỉ đi một đường', async () => {
    const orderId = await taoDonDaTra();
    await taoLoDaGiao(orderId);
    epGapNhauTruocKhiGhiSo();

    await Promise.allSettled([
      orders.confirmShipmentReceived(orderId, sellerId, nguoiMua()),
      orders.cancel(orderId, nguoiMua()),
    ]);

    const nguoiBanDuocTra = (await viCua(sellerId)) > 0n;
    const nguoiMuaDuocHoan = (await viCua(buyerId)) > 0n;
    expect([nguoiBanDuocTra, nguoiMuaDuocHoan].filter(Boolean)).toHaveLength(1);
    expect(await ketGiuHo()).toBeGreaterThanOrEqual(0n);
  });

  /** A, ở đúng tầng ký quỹ: không qua lớp kiểm nào của đơn hàng. */
  it('A: release và refund cùng lúc thì két giữ hộ không âm', async () => {
    const orderId = await taoDonDaTra();
    epGapNhauTruocKhiGhiSo();

    await Promise.allSettled([
      escrows.release(orderId, sellerId),
      escrows.refund(orderId),
    ]);

    const nguoiBanDuocTra = (await viCua(sellerId)) > 0n;
    const nguoiMuaDuocHoan = (await viCua(buyerId)) > 0n;
    expect([nguoiBanDuocTra, nguoiMuaDuocHoan].filter(Boolean)).toHaveLength(1);
    expect(await ketGiuHo()).toBe(0n);
  });
});
