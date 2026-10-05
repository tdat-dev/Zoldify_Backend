import { DataSource, FindManyOptions, FindOneOptions } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderShipment } from './entities/order-shipment.entity';
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
import { ProductsService } from '@catalog/products/products.service';
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
import { createCache } from 'cache-manager';

/**
 * BÀI KIỂM ĐỎ — luồng đặt hàng và tồn kho.
 *
 * `orders.create` đã được vá kỹ ở task #2 (khoá hàng, trừ kho có điều kiện,
 * một transaction). Các bài kiểm dưới đây KHÔNG đo lại phần đó — nó đã có
 * `npm run check:race` R1/R4. Chúng đo những chỗ NGOÀI vùng đã vá:
 *
 *   · giá trị tuyệt đối ghi đè kết quả trừ kho (`updateStock`)
 *   · các đường làm đơn biến mất mà không hoàn kho (`remove`)
 *   · thứ không bao giờ được cập nhật (`sold_count`)
 *   · thứ không bao giờ được kiểm (`product.status`, phí ship client gửi)
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

describe('Đặt hàng và tồn kho', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let products: ProductsService;

  let buyerId: number;
  let sellerId: number;
  let categoryId: number;
  let productId: number;

  let thongBaoNem = false;

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
    productId = await taoSanPham('Mon hang', ProductStatus.ACTIVE, KHO_BAN_DAU);

    thongBaoNem = false;

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

    // GHN: không gọi mạng trong test. `calculateFee` trả một con số cố định để
    // phân biệt được "server tính" với "client gửi".
    const ghn = {
      calculateFee: () => Promise.resolve({ total: PHI_SHIP_GHN }),
      createOrder: () => Promise.resolve({ order_code: `GHN-${Date.now()}` }),
      getOrderStatus: () => Promise.resolve('delivered'),
    } as unknown as GhnService;

    const notifications = {
      create: () =>
        thongBaoNem
          ? Promise.reject(new Error('Firebase timeout'))
          : Promise.resolve(undefined),
    } as unknown as NotificationsService;

    orders = new OrdersService(
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds.getRepository(OrderShipment),
      ds.getRepository(Shop),
      ds.getRepository(Cart),
      ds.getRepository(Product),
      ds.getRepository(User),
      notifications,
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

    products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      notifications,
      createCache({ ttl: 30_000 }),
    );
  });

  const PHI_SHIP_GHN = 45_000;

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

  async function taoSanPham(
    ten: string,
    status: ProductStatus,
    kho: number,
  ): Promise<number> {
    const slug = `${ten}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      .toLowerCase()
      .replace(/\s+/g, '-');
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ten, slug, GIA, kho, status, categoryId, sellerId],
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

  const khoCua = async (pid: number): Promise<number> => {
    const [p] = await ds.query<Array<{ stock: number }>>(
      `SELECT stock FROM products WHERE id = ?`,
      [pid],
    );
    return Number(p.stock);
  };

  /**
   * TC-P1-06 — BUG-06.
   *
   * `updateStock` đọc entity rồi `save()` cả entity, KHÔNG khoá dòng và KHÔNG
   * kiểm điều kiện. Một lần trừ kho xảy ra giữa lúc nó đọc và lúc nó ghi sẽ bị
   * xoá sạch.
   *
   * Xen kẽ được ép ra bằng spy trên `findOne` của chính repository mà
   * `updateStock` dùng: đơn hàng được đặt NGAY SAU khi nó đọc xong, TRƯỚC khi
   * nó ghi. Đây là cửa sổ có thật, chỉ là ở production nó mở ra ngẫu nhiên.
   */
  /**
   * TC-P2-16 — BUG-16. Giá phải đọc lại dưới khoá, không chỉ kho.
   *
   * Vòng duyệt giỏ đọc `product.price` NGOÀI transaction rồi tính `subtotal`,
   * `total_amount`, `final_amount` từ đó. Giữa lúc ấy và lúc khoá hàng có cả
   * một quãng — lưu hai bảng, và trước đó còn hỏi phí ship qua mạng.
   *
   * Người bán sửa giá đúng trong quãng đó thì đơn chốt theo GIÁ CŨ, và không
   * ai biết: hoá đơn tự khớp với chính nó. Cùng cửa sổ mà task #2 đã đóng cho
   * `stock`, chỉ khác là nó bỏ sót `price`.
   *
   * Xen kẽ ép ra bằng spy trên `cartRepository.find` — đúng lời gọi mở đầu
   * `orders.create`. Giá bị đổi NGAY SAU khi giỏ được đọc, TRƯỚC khi hàng bị
   * khoá. Ở production cửa sổ đó mở ra ngẫu nhiên.
   */
  it('TC-P2-16 — giá đổi giữa chừng thì từ chối, không chốt giá cũ', async () => {
    await themVaoGio(productId, 1);

    const gioRepo = ds.getRepository(Cart);
    const goc = gioRepo.find.bind(gioRepo) as (
      o: FindManyOptions<Cart>,
    ) => Promise<Cart[]>;
    const spy = jest
      .spyOn(gioRepo, 'find')
      .mockImplementationOnce(async (opts: FindManyOptions<Cart>) => {
        const items = await goc(opts);
        // Người bán vừa tăng giá, ngay sau khi giỏ được đọc.
        await ds.query('UPDATE products SET price = ? WHERE id = ?', [
          GIA * 2,
          productId,
        ]);
        return items;
      });

    await expect(orders.create(donMacDinh(), nguoiMua())).rejects.toThrow(
      /giá|thay đổi/i,
    );
    spy.mockRestore();

    // Và không được để lại đơn dở: transaction phải quay lui sạch.
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM orders WHERE user_id = ?',
      [buyerId],
    );
    expect(Number(n)).toBe(0);
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU);
  });

  it('TC-P1-06 — updateStock không được xoá kết quả trừ kho', async () => {
    const repo = ds.getRepository(Product);
    // `bind` trả `any`; ép kiểu lại một lần ở đây để phần thân spy bên dưới
    // không phải rải `as` lên từng dòng.
    const goc = repo.findOne.bind(repo) as (
      o: FindOneOptions<Product>,
    ) => Promise<Product | null>;
    const spy = jest
      .spyOn(repo, 'findOne')
      .mockImplementationOnce(async (opts: FindOneOptions<Product>) => {
        const p = await goc(opts);
        // Ngay lúc này có người đặt 3 món — đơn chạy trọn vẹn, kho còn 47.
        await themVaoGio(productId, 3);
        await orders.create(donMacDinh(), nguoiMua());
        return p;
      });

    // Người bán bấm lưu lại đúng con số họ nhìn thấy trên màn hình (50).
    // Phải bị TỪ CHỐI, vì kho đã không còn là 50 nữa.
    await expect(
      products.updateStock(productId, KHO_BAN_DAU, sellerId, false),
    ).rejects.toThrow();
    spy.mockRestore();

    // Và điều quan trọng hơn lời từ chối: ba món vừa bán vẫn còn được trừ.
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU - 3);
  });

  /**
   * TC-P1-08 — BUG-08.
   *
   * `remove()` chỉ gọi `findOne(id, user)` — mà người mua là chủ đơn nên qua
   * được — rồi `softDelete` thẳng. Không kiểm trạng thái, không hoàn kho,
   * không đụng tới ký quỹ.
   *
   * Đơn biến mất khỏi danh sách của CẢ người bán (soft-delete lọc ở tầng
   * repository), trong khi hàng vẫn đang trừ và tiền vẫn đang giữ.
   */
  it('TC-P1-08 — không xoá được đơn đã thanh toán / đang giao', async () => {
    await themVaoGio(productId, 2);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;

    await ds.query(
      `UPDATE orders SET status = 'confirmed', is_paid = 1 WHERE id = ?`,
      [don.id],
    );

    await expect(orders.remove(don.id, nguoiMua())).rejects.toThrow();
  });

  /**
   * TC-P1-10a — BUG-10.
   *
   * `sold_count` không được cộng ở bất kỳ đâu trong repo (grep toàn bộ `src`:
   * chỉ xuất hiện trong `ORDER BY` khi sắp xếp "bán chạy"). Nghĩa là danh sách
   * bán chạy đang sắp xếp theo một cột luôn bằng 0.
   */
  it('TC-P1-10a — mua xong thì sold_count phải tăng', async () => {
    await themVaoGio(productId, 3);
    await orders.create(donMacDinh(), nguoiMua());

    const [p] = await ds.query<Array<{ sold_count: number }>>(
      `SELECT sold_count FROM products WHERE id = ?`,
      [productId],
    );
    expect(Number(p.sold_count)).toBe(3);
  });

  /**
   * TC-P1-10b — BUG-10.
   *
   * `orders.create` kiểm tiền tệ, kiểm tự-mua-hàng-mình, kiểm tồn kho — nhưng
   * KHÔNG kiểm `product.status`. Hàng nháp, hàng chờ duyệt và hàng đã bị từ
   * chối duyệt đều đặt được.
   */
  it('TC-P1-10b — không mua được hàng chưa mở bán', async () => {
    const nhap = await taoSanPham('Hang nhap', ProductStatus.DRAFT, 10);
    await themVaoGio(nhap, 1);

    await expect(orders.create(donMacDinh(), nguoiMua())).rejects.toThrow();
  });

  /**
   * TC-P2-11 — BUG-11.
   *
   * `order_code` = `ORD-<ngày>-<random 0..999>` trên cột UNIQUE. Chỉ có 1000
   * giá trị cho mỗi ngày, nên theo nghịch lý sinh nhật xác suất trùng chạm 50%
   * ở khoảng 37 đơn/ngày.
   *
   * 120 đơn ở đây gần như chắc chắn có trùng. Mỗi lần trùng là một người mua
   * thật nhận 500.
   */
  it('TC-P2-11 — 120 đơn trong cùng một ngày không được trùng order_code', async () => {
    const kho = await taoSanPham('Hang nhieu', ProductStatus.ACTIVE, 500);
    const loi: string[] = [];

    for (let i = 0; i < 120; i++) {
      await themVaoGio(kho, 1);
      try {
        await orders.create(donMacDinh(), nguoiMua());
      } catch (e) {
        loi.push((e as Error).message);
      }
    }

    expect(loi).toEqual([]);
  });

  /**
   * TC-P2-12 — BUG-12.
   *
   * Bình luận ở `orders.service.ts:192` viết: "Phí ship do SERVER tính, không
   * tin số client gửi lên". Dòng ngay dưới nó lại lấy đúng số client gửi làm
   * giá trị khởi tạo, và chỉ ghi đè khi client CÓ gửi `ghn_district_id` +
   * `ghn_ward_code`.
   *
   * Cả hai trường đó đều `@IsOptional`. Bỏ trống là phí ship bằng đúng thứ
   * client muốn.
   */
  it('TC-P2-12 — client không tự quyết định phí ship', async () => {
    await themVaoGio(productId, 1);

    // Gửi một con số vô lý. Nếu nó lọt vào đơn thì client đang cầm quyền định
    // giá vận chuyển — và cũng con đường đó cho phép gửi 0 để đi ship miễn phí.
    const BIA_DAT = 999_999;
    const don = (await orders.create(
      { ...donMacDinh(), shipping_fee: BIA_DAT },
      nguoiMua(),
    )) as Order;

    expect(Number(don.shipping_fee)).not.toBe(BIA_DAT);

    // Và `final_amount` phải khớp với phí ship thật sự được ghi, không khớp với
    // số client gửi — nếu không thì hoá đơn tự lệch.
    expect(Number(don.final_amount)).toBe(
      Number(don.total_amount) + Number(don.shipping_fee),
    );
  });

  /**
   * TC-P2-13 — BUG-13.
   *
   * ```ts
   * if (!product) {
   *   throw new NotFoundException(`Sản phẩm ID ${cartItem.product.id} ...`);
   * }
   * ```
   *
   * Câu thông báo đọc `cartItem.product.id` ngay trong nhánh `product` là rỗng.
   * Người mua nhận `TypeError` 500 thay vì một câu tiếng Việt nói rõ món nào
   * đã bị gỡ khỏi sàn.
   */
  it('TC-P2-13 — sản phẩm đã gỡ bán thì báo lỗi tử tế, không 500', async () => {
    await themVaoGio(productId, 1);
    await ds.getRepository(Product).softDelete(productId);

    await expect(orders.create(donMacDinh(), nguoiMua())).rejects.not.toThrow(
      TypeError,
    );
  });

  /**
   * TC-P2-14 — BUG-14.
   *
   * `notificationsService.create` nằm SAU transaction và KHÔNG có `try/catch`.
   * Nó gọi sang Firebase; Firebase chậm hoặc lỗi là chuyện thường.
   *
   * Lúc đó kho đã trừ, giỏ đã xoá, đơn đã lưu — nhưng người mua thấy 500 và
   * bấm lại. Lần bấm thứ hai tạo đơn thứ hai, trừ kho lần thứ hai.
   */
  it('TC-P2-14 — thông báo hỏng không được làm hỏng việc đặt hàng', async () => {
    await themVaoGio(productId, 1);
    thongBaoNem = true;

    await expect(
      orders.create(donMacDinh(), nguoiMua()),
    ).resolves.toBeDefined();
  });

  /**
   * TC-P3-21 — BUG-21.
   *
   * `getStats` cộng `final_amount` của mọi đơn khác `cancelled`, kể cả đơn
   * `pending` chưa ai trả một đồng nào. Con số này hiện trên dashboard admin.
   */
  it('TC-P3-21 — doanh thu chỉ tính đơn đã trả tiền', async () => {
    await themVaoGio(productId, 1);
    await orders.create(donMacDinh(), nguoiMua()); // pending, is_paid = 0

    const stats = await orders.getStats();
    expect(stats.total_revenue).toBe(0);
  });

  /**
   * TC-P1-07 — BUG-07.
   *
   * Hai lỗi chồng nhau ở nhánh hoàn tiền:
   *   · `updateStatus` sang `REFUNDED` không hoàn kho (khác hẳn `cancel`).
   *   · Và nó không chạy nổi: từ `delivered` thì ký quỹ đã `released`, từ
   *     `cancelled` thì đã `refunded` — cả hai đường đều không còn khoản
   *     `holding` nào, nên `refund()` ném.
   *
   * Nghĩa là admin KHÔNG hoàn tiền được đơn nào qua API, và nếu có hoàn được
   * thì hàng cũng không về kho.
   */
  it('TC-P1-07 — hoàn tiền đơn đã giao thì hàng phải về kho', async () => {
    await themVaoGio(productId, 4);
    const don = (await orders.create(donMacDinh(), nguoiMua())) as Order;
    expect(await khoCua(productId)).toBe(KHO_BAN_DAU - 4);

    await ds.query(`UPDATE orders SET status = ?, is_paid = 1 WHERE id = ?`, [
      OrderStatus.DELIVERED,
      don.id,
    ]);

    const admin: IUser = {
      id: 999,
      full_name: 'admin',
      email: 'a@t.local',
      role: UserRole.ADMIN,
      avatar: '',
    };

    await orders.updateStatus(don.id, { status: OrderStatus.REFUNDED }, admin);

    expect(await khoCua(productId)).toBe(KHO_BAN_DAU);
  });
});
