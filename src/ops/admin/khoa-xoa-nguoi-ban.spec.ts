import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { ProductsService } from '@catalog/products/products.service';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { OrdersService } from '@ordering/orders/orders.service';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { ShipmentTrackingService } from '@ordering/orders/shipment-tracking.service';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { GhnService } from '@ordering/ghn/ghn.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { PayosService } from '@money/payos/payos.service';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { Withdrawal } from '@money/withdrawals/entities/withdrawal.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';

import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 7: khoá/xoá người bán phải dọn hàng và đơn.
 *
 * Tới 26/10 `toggleUserLock` và `deleteUser` chỉ đổi đúng dòng users:
 *   · hàng của người bán bị khoá vẫn `active`, vẫn bày ở trang chủ, vẫn đặt
 *     được, mà người bán không đăng nhập được để xác nhận hay giao;
 *   · đơn `pending` chưa trả tiền của họ nằm đó giữ kho tới khi cron 48 giờ;
 *   · `toggleUserLock` đọc rồi lật: admin bấm hai lần (hay trình duyệt gửi
 *     lại) là khoá rồi mở luôn, không có cách nói "tôi muốn KHOÁ".
 * Và `ProductsService.remove` xoá mềm được món đang nằm trong đơn chưa xong.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

describe('Khoá / xoá người bán', () => {
  let ds: DataSource;
  let admin: AdminService;
  let orders: OrdersService;
  let products: ProductsService;
  let buyerId: number;
  let sellerId: number;
  let khacId: number;
  let categoryId: number;

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
        Withdrawal,
        LedgerAccount,
        LedgerTransaction,
        LedgerEntry,
      ],
      synchronize: true,
      logging: false,
    });
    await ds.initialize();
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
    khacId = await taoUser('khac@t.local', UserRole.SELLER);
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-kx')`);
    const [c] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    categoryId = c.id;

    const notifications = {
      create: () => Promise.resolve(undefined),
    } as unknown as NotificationsService;
    const khoPhat = {
      phat: () => Promise.resolve(),
    } as unknown as StockEventsService;
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
    products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      notifications,
      createCache({ ttl: 30_000 }),
      khoPhat,
    );
    orders = new OrdersService(
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds.getRepository(OrderShipment),
      ds.getRepository(Shop),
      ds.getRepository(Cart),
      ds.getRepository(Product),
      ds.getRepository(User),
      notifications,
      {
        calculateFee: () => Promise.resolve({ total: 30_000 }),
      } as unknown as GhnService,
      escrows,
      {
        voidOpenLinkForOrder: () => Promise.resolve(false),
      } as unknown as PayosService,
      {} as unknown as ShipmentTrackingService,
      ds,
      khoPhat,
    );
    admin = new (AdminService as unknown as new (
      ...a: unknown[]
    ) => AdminService)(
      ds.getRepository(User),
      ds.getRepository(Order),
      ds.getRepository(Product),
      ds.getRepository(Setting),
      ds.getRepository(Withdrawal),
      {},
      orders,
      products,
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

  async function taoSanPham(chu: number, kho = 10): Promise<number> {
    const slug = `kx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('Mon', ?, 100000, ?, 'active', ?, ?)`,
      [slug, kho, categoryId, chu],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM products WHERE slug = ?`,
      [slug],
    );
    return p.id;
  }

  async function datDon(pid: number, qty = 1): Promise<number> {
    await ds.query(
      `INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)`,
      [buyerId, pid, qty],
    );
    const don = (await orders.create(
      {
        shipping_address: 'so 1',
        receiver_name: 'N',
        receiver_phone: '0900000000',
        payment_method: PaymentMethod.COD,
        ghn_district_id: 1442,
        ghn_ward_code: '20101',
      },
      {
        id: buyerId,
        full_name: 'b',
        email: 'buyer@t.local',
        role: UserRole.BUYER,
        avatar: '',
      },
    )) as Order;
    return don.id;
  }

  const trangThaiSp = async (id: number) =>
    (
      await ds.query<Array<{ status: string }>>(
        'SELECT status FROM products WHERE id = ?',
        [id],
      )
    )[0].status;
  const trangThaiDon = async (id: number) =>
    (
      await ds.query<Array<{ status: string }>>(
        'SELECT status FROM orders WHERE id = ?',
        [id],
      )
    )[0].status;
  const khoCua = async (id: number) =>
    Number(
      (
        await ds.query<Array<{ stock: number }>>(
          'SELECT stock FROM products WHERE id = ?',
          [id],
        )
      )[0].stock,
    );
  const userLuc = async (id: number) =>
    (
      await ds.query<Array<{ is_locked: number; token_version: number }>>(
        'SELECT is_locked, token_version FROM users WHERE id = ?',
        [id],
      )
    )[0];

  type KhoaCoDich = (id: number, khoa?: boolean) => Promise<unknown>;
  const khoa: KhoaCoDich = (id, k) =>
    (admin as unknown as { toggleUserLock: KhoaCoDich }).toggleUserLock(id, k);

  it('khoá người bán: hàng của họ thôi bày bán, hàng người khác giữ nguyên', async () => {
    const cuaHo = await taoSanPham(sellerId);
    const cuaKhac = await taoSanPham(khacId);

    await khoa(sellerId, true);

    expect(await trangThaiSp(cuaHo)).not.toBe(ProductStatus.ACTIVE);
    expect(await trangThaiSp(cuaKhac)).toBe(ProductStatus.ACTIVE);
  });

  it('khoá người bán: đơn pending chưa trả tiền bị huỷ qua đường huỷ chung (kho về), đơn đã xác nhận giữ nguyên', async () => {
    const sp = await taoSanPham(sellerId, 10);
    const choTra = await datDon(sp, 2);
    const daXacNhan = await datDon(sp, 1);
    await ds.query(`UPDATE orders SET status = 'confirmed' WHERE id = ?`, [
      daXacNhan,
    ]);
    expect(await khoCua(sp)).toBe(7);

    await khoa(sellerId, true);

    expect(await trangThaiDon(choTra)).toBe(OrderStatus.CANCELLED);
    expect(await trangThaiDon(daXacNhan)).toBe(OrderStatus.CONFIRMED);
    expect(await khoCua(sp)).toBe(9);
  });

  it('đặt trạng thái TƯỜNG MINH: khoá hai lần vẫn là khoá, phiên chỉ bị thu hồi một lần', async () => {
    await khoa(sellerId, true);
    const sau1 = await userLuc(sellerId);
    await khoa(sellerId, true);
    const sau2 = await userLuc(sellerId);

    expect(Number(sau2.is_locked)).toBe(1);
    expect(Number(sau2.token_version)).toBe(Number(sau1.token_version));
  });

  it('không gửi trạng thái thì vẫn lật như cũ (web admin gọi toggle-lock không body)', async () => {
    await khoa(sellerId);
    expect(Number((await userLuc(sellerId)).is_locked)).toBe(1);
    await khoa(sellerId);
    expect(Number((await userLuc(sellerId)).is_locked)).toBe(0);
  });

  /**
   * Review 26/10 mục 3. Dọn dẹp chỉ chạy khi trạng thái THẬT SỰ đổi. Khoá đã
   * ghi xong mà bước ẩn hàng/huỷ đơn hỏng (mất kết nối DB giữa chừng), thì
   * lần gọi lại thấy "đã khoá rồi" và bỏ qua dọn dẹp mãi mãi: hàng của người
   * bị khoá vẫn bày bán, đơn chờ vẫn giữ kho.
   */
  it('khoá xong mà dọn dẹp hỏng: gọi lại khoá thì dọn tiếp, phiên chỉ bị thu hồi một lần', async () => {
    const sp = await taoSanPham(sellerId, 10);
    const choTra = await datDon(sp, 1);
    const an = jest
      .spyOn(products, 'anHangCuaNguoiBan')
      .mockRejectedValueOnce(new Error('mất kết nối giữa chừng'));

    await expect(khoa(sellerId, true)).rejects.toThrow(/mất kết nối/);
    const sauLan1 = await userLuc(sellerId);
    expect(Number(sauLan1.is_locked)).toBe(1);

    await khoa(sellerId, true);
    an.mockRestore();

    expect(await trangThaiSp(sp)).not.toBe(ProductStatus.ACTIVE);
    expect(await trangThaiDon(choTra)).toBe(OrderStatus.CANCELLED);
    expect(Number((await userLuc(sellerId)).token_version)).toBe(
      Number(sauLan1.token_version),
    );
  });

  it('mở khoá: hàng bị ẩn vì khoá được bày bán lại', async () => {
    const sp = await taoSanPham(sellerId);
    await khoa(sellerId, true);
    await khoa(sellerId, false);
    expect(await trangThaiSp(sp)).toBe(ProductStatus.ACTIVE);
  });

  it('xoá người bán: hàng thôi bày bán, đơn pending chưa trả bị huỷ', async () => {
    const sp = await taoSanPham(sellerId, 5);
    const choTra = await datDon(sp, 1);

    await admin.deleteUser(sellerId);

    expect(await trangThaiSp(sp)).not.toBe(ProductStatus.ACTIVE);
    expect(await trangThaiDon(choTra)).toBe(OrderStatus.CANCELLED);
    expect(await khoCua(sp)).toBe(5);
  });

  it('có route khoá và mở khoá riêng, toggle-lock vẫn còn', () => {
    const duong = (ten: string) =>
      Reflect.getMetadata(
        PATH_METADATA,
        (AdminController.prototype as unknown as Record<string, object>)[ten],
      ) as string | undefined;
    expect(duong('toggleUserLock')).toBe('users/:id/toggle-lock');
    expect(duong('lockUser')).toBe('users/:id/lock');
    expect(duong('unlockUser')).toBe('users/:id/unlock');
  });

  it('xoá sản phẩm đang nằm trong đơn chưa xong thì bị từ chối', async () => {
    const sp = await taoSanPham(sellerId);
    const don = await datDon(sp, 1);
    await ds.query(`UPDATE orders SET status = 'shipping' WHERE id = ?`, [don]);

    await expect(
      products.remove(sp, {
        id: sellerId,
        full_name: 's',
        email: 'seller@t.local',
        role: UserRole.SELLER,
        avatar: '',
      }),
    ).rejects.toThrow(/đơn/i);
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM products WHERE id = ? AND deleted_at IS NULL',
      [sp],
    );
    expect(Number(n)).toBe(1);
  });

  it('đối chứng: sản phẩm chỉ còn đơn đã xong thì xoá được', async () => {
    const sp = await taoSanPham(sellerId);
    const don = await datDon(sp, 1);
    await ds.query(`UPDATE orders SET status = 'delivered' WHERE id = ?`, [
      don,
    ]);

    await expect(
      products.remove(sp, {
        id: sellerId,
        full_name: 's',
        email: 'seller@t.local',
        role: UserRole.SELLER,
        avatar: '',
      }),
    ).resolves.toMatchObject({ deleted: true });
  });
});
