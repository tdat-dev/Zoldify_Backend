import { ConflictException } from '@nestjs/common';
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
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
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
  let giuaGhn: (() => Promise<unknown>) | undefined;

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

    // `createOrder` là lời gọi mạng dài nhất trong `updateStatus`, nên cũng
    // là cửa sổ rộng nhất để một thao tác khác chen vào. `giuaGhn` cho bài
    // kiểm chạy đúng thao tác đó ở đúng chỗ ấy, một lần.
    giuaGhn = undefined;
    const ghn = {
      calculateFee: () => Promise.resolve({ total: 0 }),
      createOrder: async () => {
        const chen = giuaGhn;
        giuaGhn = undefined;
        if (chen) await chen();
        return { order_code: `GHN-${Date.now()}` };
      },
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

  const nguoiBan = (): IUser => ({
    id: sellerId,
    full_name: 'seller',
    email: 'seller@t.local',
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

  const donLuc = async (
    id: number,
  ): Promise<{ status: string; is_paid: number }> => {
    const [d] = await ds.query<Array<{ status: string; is_paid: number }>>(
      `SELECT status, is_paid FROM orders WHERE id = ?`,
      [id],
    );
    return { status: d.status, is_paid: Number(d.is_paid) };
  };

  /** Đơn chờ xác nhận, có địa chỉ GHN nên lúc xác nhận sẽ gọi tạo vận đơn. */
  async function taoDonChoGhn(soLuong = 2): Promise<number> {
    await themVaoGio(productId, soLuong);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    await ds.query(
      `UPDATE orders SET ghn_district_id = 1442, ghn_ward_code = '20101' WHERE id = ?`,
      [don.id],
    );
    return don.id;
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

  /**
   * B. Người bán xác nhận đơn trong lúc người mua huỷ.
   *
   * `updateStatus` đọc đơn, gọi GHN qua mạng (vài giây), rồi `save(order)`
   * NGUYÊN entity đã đọc từ trước. Huỷ đơn commit xong trong khoảng đó (hoàn
   * kho, CANCELLED) thì bị ghi đè ngược về CONFIRMED: đơn sống lại trong khi
   * hàng đã về kho, người sau đặt được đúng món đó lần nữa.
   */
  it('B: huỷ chen vào giữa lúc xác nhận thì đơn không sống lại, trả 409', async () => {
    const orderId = await taoDonChoGhn(2);
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU - 2);

    giuaGhn = () => orders.cancel(orderId, nguoiMua());

    await expect(
      orders.updateStatus(
        orderId,
        { status: OrderStatus.CONFIRMED },
        nguoiBan(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect((await donLuc(orderId)).status).toBe(OrderStatus.CANCELLED);
    // Hoàn kho đúng MỘT lần, bởi lượt huỷ.
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU);
  });

  /**
   * B, hậu quả còn lại: vận đơn GHN đã tạo xong cho một lần xác nhận thua.
   *
   * Đơn không sống lại nữa, nhưng vận đơn bên GHN thì vẫn sống: tài xế vẫn tới
   * lấy hàng của một đơn đã huỷ. Ít nhất nó phải được đánh dấu trên chính dòng
   * vận đơn để người bán/admin nhìn thấy mà huỷ tay.
   */
  it('B: vận đơn GHN mồ côi sau khi thua lượt huỷ phải được đánh dấu', async () => {
    const orderId = await taoDonChoGhn(1);
    giuaGhn = () => orders.cancel(orderId, nguoiMua());

    await orders
      .updateStatus(orderId, { status: OrderStatus.CONFIRMED }, nguoiBan())
      .catch(() => undefined);

    const lo = await ds.getRepository(OrderShipment).find({
      where: { order: { id: orderId } },
    });
    expect(lo).toHaveLength(1);
    expect(lo[0].error ?? '').toMatch(/huỷ.*GHN/);
  });

  /**
   * B, mặt tiền: cùng cái `save(order)` cũ ghi đè luôn `is_paid`.
   *
   * Webhook PayOS commit `is_paid = 1` trong lúc người bán đang chờ GHN; lần
   * lưu entity cũ kéo nó về 0. Tiền đã vào két mà đơn ghi là chưa trả.
   *
   * Chỗ chen dùng một câu UPDATE: thứ cần đo là "có một commit đáp xuống dòng
   * này giữa lúc đọc và lúc ghi", không phải bản thân webhook (webhook có bài
   * kiểm riêng ở `payos`).
   */
  it('B: tiền về giữa lúc xác nhận thì is_paid không bị ghi đè về 0', async () => {
    const orderId = await taoDonChoGhn(1);

    giuaGhn = () =>
      ds.query(`UPDATE orders SET is_paid = 1, paid_at = NOW() WHERE id = ?`, [
        orderId,
      ]);

    await orders.updateStatus(
      orderId,
      { status: OrderStatus.CONFIRMED },
      nguoiBan(),
    );

    expect(await donLuc(orderId)).toEqual({
      status: OrderStatus.CONFIRMED,
      is_paid: 1,
    });
  });

  /** Lô có vận đơn GHN thật, với trạng thái và mốc giao tuỳ chọn. */
  async function taoLoGhn(
    orderId: number,
    status: ShipmentStatus,
    deliveredAt?: Date,
  ): Promise<void> {
    const repo = ds.getRepository(OrderShipment);
    await repo.save(
      repo.create({
        order: { id: orderId } as Order,
        seller: { id: sellerId } as User,
        tracking_code: `GHN-${orderId}`,
        cod_amount: GIA,
        status,
        delivered_at: deliveredAt,
      }),
    );
  }

  /**
   * E. Huỷ đơn khi kiện hàng đã nằm trong tay GHN.
   *
   * Cron huỷ đơn quá hạn đã bỏ qua đơn có mã vận đơn (tasks.service.ts), vì
   * huỷ lúc đó là hoàn tiền người mua trong khi món hàng vẫn đang đi tới nhà
   * họ. Nút huỷ của người mua và "huỷ bán" của người bán thì không kiểm gì.
   */
  it('E: không huỷ được đơn đã có vận đơn GHN đang đi', async () => {
    const orderId = await taoDonDaTra();
    await taoLoGhn(orderId, ShipmentStatus.CREATED);

    await expect(orders.cancel(orderId, nguoiMua())).rejects.toThrow(
      /vận đơn/i,
    );
    await expect(orders.cancelSale(orderId, nguoiBan())).rejects.toThrow(
      /vận đơn/i,
    );

    expect((await donLuc(orderId)).status).toBe(OrderStatus.CONFIRMED);
    expect(await viCua(buyerId)).toBe(0n);
  });

  /**
   * E. Đơn đã huỷ không được thành "đã giao".
   *
   * `confirmShipmentReceived` không nhìn trạng thái đơn, và
   * `reconcileOrderDelivered` đặt DELIVERED chỉ với điều kiện "chưa phải
   * DELIVERED". Đơn huỷ còn một lô GHN sống (vận đơn mồ côi, xem B) thì người
   * mua bấm "đã nhận" là đơn huỷ thành đơn giao xong.
   */
  it('E: xác nhận đã nhận trên đơn đã huỷ bị từ chối, đơn vẫn là huỷ', async () => {
    const orderId = await taoDonDaTra();
    await orders.cancel(orderId, nguoiMua());
    await taoLoGhn(orderId, ShipmentStatus.DELIVERED, new Date());

    await expect(
      orders.confirmShipmentReceived(orderId, sellerId, nguoiMua()),
    ).rejects.toThrow();

    expect((await donLuc(orderId)).status).toBe(OrderStatus.CANCELLED);
  });

  it('E: tự xác nhận sau N ngày bỏ qua đơn đã huỷ', async () => {
    const orderId = await taoDonDaTra();
    await orders.cancel(orderId, nguoiMua());
    const muoiNgayTruoc = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await taoLoGhn(orderId, ShipmentStatus.DELIVERED, muoiNgayTruoc);

    await orders.autoConfirmDueShipments();

    expect((await donLuc(orderId)).status).toBe(OrderStatus.CANCELLED);
    const [lo] = await ds.getRepository(OrderShipment).find({
      where: { order: { id: orderId } },
    });
    expect(lo.status).toBe(ShipmentStatus.DELIVERED);
  });

  const quanTri = (): IUser => ({
    id: 999,
    full_name: 'admin',
    email: 'a@t.local',
    role: UserRole.ADMIN,
    avatar: '',
  });

  /**
   * F. Hoàn tiền một đơn đã huỷ cộng kho lần thứ hai.
   *
   * Bảng trạng thái cho `cancelled -> refunded`, và nhánh REFUNDED của
   * `updateStatus` cộng kho vô điều kiện. Nhưng huỷ đơn đã hoàn kho rồi: kho
   * phình ra đúng số món của đơn, người sau đặt được hàng không có thật.
   */
  it('F: huỷ rồi hoàn tiền thì kho chỉ được cộng lại một lần', async () => {
    const orderId = await taoDonDaTra(2);
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU - 2);

    await orders.cancel(orderId, nguoiMua());
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU);

    await orders.updateStatus(
      orderId,
      { status: OrderStatus.REFUNDED },
      quanTri(),
    );
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU);
  });

  /**
   * F, mặt trạng thái: REFUNDED được LƯU TRƯỚC, hoàn tiền chạy SAU trong một
   * transaction riêng.
   *
   * Người bán đã tiêu hết tiền vừa nhận thì lệnh đòi lại bị sổ cái từ chối
   * (đúng như thiết kế), nhưng đơn đã nằm ở `refunded` rồi: người mua thấy
   * "đã hoàn tiền" mà ví không có đồng nào, và admin không bấm lại được vì
   * bảng trạng thái chặn `refunded -> refunded`.
   */
  it('F: hoàn tiền hỏng thì đơn không được ghi là đã hoàn tiền', async () => {
    const orderId = await taoDonDaTra(1);
    await taoLoDaGiao(orderId);
    await orders.confirmShipmentReceived(orderId, sellerId, nguoiMua());
    expect((await donLuc(orderId)).status).toBe(OrderStatus.DELIVERED);

    // Người bán rút sạch số vừa nhận.
    const soDu = await viCua(sellerId);
    const viBan = await ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      sellerId,
      LedgerPurpose.AVAILABLE,
    );
    const nganHang = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.BANK_EXTERNAL,
    );
    await ledger.post({
      idempotencyKey: `test_rut_het:${sellerId}`,
      type: LedgerTxType.ADJUSTMENT,
      entries: [
        { accountId: Number(viBan.id), amount: -soDu },
        { accountId: Number(nganHang.id), amount: soDu },
      ],
    });

    await expect(
      orders.updateStatus(orderId, { status: OrderStatus.REFUNDED }, quanTri()),
    ).rejects.toThrow();

    expect((await donLuc(orderId)).status).toBe(OrderStatus.DELIVERED);
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU - 1);
  });

  async function taoDonCod(): Promise<number> {
    await themVaoGio(productId, 1);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    return don.id;
  }

  const soKyQuy = async (orderId: number): Promise<number> => {
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM escrows WHERE order_id = ?',
      [orderId],
    );
    return Number(n);
  };

  /**
   * H. Admin ghi nhận "đã thu tiền" trên một đơn đã huỷ.
   *
   * Nhánh `is_paid` không nhìn trạng thái: đơn đã huỷ (hàng đã về kho) vẫn
   * được ghi tiền vào két và sinh khoản ký quỹ `holding` mà không đường nào
   * giải ngân hay hoàn được nữa, vì đơn đã đóng.
   */
  it('H: không ghi nhận đã thu tiền cho đơn đã huỷ', async () => {
    const orderId = await taoDonCod();
    await orders.cancel(orderId, nguoiMua());

    await expect(
      orders.updateStatus(orderId, { is_paid: true }, quanTri()),
    ).rejects.toThrow();

    expect((await donLuc(orderId)).is_paid).toBe(0);
    expect(await soKyQuy(orderId)).toBe(0);
    expect(await ketGiuHo()).toBe(0n);
  });

  /**
   * H. `is_paid` được lưu TRƯỚC, ghi két + tách ký quỹ chạy SAU trong một
   * transaction riêng.
   *
   * Bước sau hỏng thì đơn đã là "đã trả tiền" mà két rỗng, không ký quỹ. Admin
   * bấm lại thì `vuaDanhDauDaTra` ra false (cờ đã bật) nên bước ghi két không
   * bao giờ chạy lại: người bán không bao giờ được giải ngân đơn này.
   */
  it('H: ghi két hỏng giữa chừng thì bấm lại được và tiền vào đủ', async () => {
    const orderId = await taoDonCod();
    jest
      .spyOn(escrows, 'createOrderEscrowsWithExternalFunding')
      .mockRejectedValueOnce(new Error('sập giữa chừng'));

    await expect(
      orders.updateStatus(orderId, { is_paid: true }, quanTri()),
    ).rejects.toThrow('sập giữa chừng');

    await orders.updateStatus(orderId, { is_paid: true }, quanTri());

    expect((await donLuc(orderId)).is_paid).toBe(1);
    expect(await soKyQuy(orderId)).toBe(1);
    expect(await ketGiuHo()).toBe(BigInt(GIA));
  });

  /**
   * Thử khoá NGAY (NOWAIT) dòng đơn và dòng người bán từ một kết nối khác.
   * Trả về tên những bảng đang bị ai đó giữ khoá.
   */
  async function dongDangBiKhoa(orderId: number): Promise<string[]> {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    const biKhoa: string[] = [];
    try {
      for (const [bang, id] of [
        ['orders', orderId],
        ['users', sellerId],
      ] as const) {
        try {
          await qr.query(
            `SELECT id FROM ${bang} WHERE id = ? FOR UPDATE NOWAIT`,
            [id],
          );
        } catch {
          biKhoa.push(bang);
        }
      }
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
    return biKhoa;
  }

  /**
   * Review 1: khoá ký quỹ khoá lây dòng `orders` và dòng `users` của người bán.
   *
   * `em.find` với `where: { order: { id } }` sinh LEFT JOIN sang bảng quan hệ,
   * và `FOR UPDATE` của MySQL khoá MỌI dòng nó đọc, kể cả dòng JOIN. Giữ khoá
   * dòng người bán S trong lúc chờ khoá két giữ hộ là đủ để tạo vòng chờ với
   * một webhook đang giữ két và chèn ký quỹ cho đơn khác của S (kiểm khoá
   * ngoại cần khoá chia sẻ trên dòng S): MySQL ném 1213, API trả 500.
   */
  it('review 1: release giữ khoá ký quỹ nhưng không khoá dòng đơn, dòng người bán', async () => {
    const orderId = await taoDonDaTra();
    let biKhoa: string[] | undefined;
    const goc = ledger.getOrCreateAccount.bind(ledger) as (
      ...a: Parameters<LedgerService['getOrCreateAccount']>
    ) => ReturnType<LedgerService['getOrCreateAccount']>;
    jest
      .spyOn(ledger, 'getOrCreateAccount')
      .mockImplementation(async (...a) => {
        // Lần đầu tới đây là lúc `release` đã khoá ký quỹ, chưa ghi sổ.
        if (biKhoa === undefined) biKhoa = await dongDangBiKhoa(orderId);
        return goc(...a);
      });

    await escrows.release(orderId, sellerId);

    expect(biKhoa).toEqual([]);
  });

  /** Đơn đã xác nhận, lần tạo vận đơn trước bị GHN từ chối (lô FAILED). */
  async function taoDonCanTaoLaiVanDon(): Promise<number> {
    const orderId = await taoDonChoGhn(1);
    await ds.query(`UPDATE orders SET status = 'confirmed' WHERE id = ?`, [
      orderId,
    ]);
    const repo = ds.getRepository(OrderShipment);
    await repo.save(
      repo.create({
        order: { id: orderId } as Order,
        seller: { id: sellerId } as User,
        cod_amount: GIA,
        status: ShipmentStatus.FAILED,
        error: 'GHN 400: quận ngừng phục vụ',
      }),
    );
    return orderId;
  }

  /**
   * Review 2: \`retryGhnShipments\` có đúng cái lỗi mà bản vá B đã sửa ở
   * \`updateStatus\`: đọc đơn, gọi GHN qua mạng, rồi \`save(order)\` NGUYÊN entity
   * cũ. Tiền về trong lúc chờ GHN thì \`is_paid\` bị kéo về 0.
   */
  it('review 2: tạo lại vận đơn không ghi đè is_paid vừa được đặt', async () => {
    const orderId = await taoDonCanTaoLaiVanDon();
    giuaGhn = () =>
      ds.query(`UPDATE orders SET is_paid = 1, paid_at = NOW() WHERE id = ?`, [
        orderId,
      ]);

    await orders.retryGhnShipments(orderId, nguoiBan());

    expect((await donLuc(orderId)).is_paid).toBe(1);
  });

  it('review 2: tạo lại vận đơn không hồi sinh đơn vừa bị huỷ', async () => {
    const orderId = await taoDonCanTaoLaiVanDon();
    giuaGhn = () =>
      ds.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [
        orderId,
      ]);

    await orders.retryGhnShipments(orderId, nguoiBan()).catch(() => undefined);

    expect((await donLuc(orderId)).status).toBe(OrderStatus.CANCELLED);
  });
});
