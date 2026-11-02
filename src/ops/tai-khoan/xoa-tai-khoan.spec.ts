import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DataSource } from 'typeorm';
import { createCache } from 'cache-manager';
import { hashSync } from 'bcrypt';
import { XoaTaiKhoanService } from './xoa-tai-khoan.service';
import { XoaTaiKhoanController } from './xoa-tai-khoan.controller';
import { ProductsService } from '@catalog/products/products.service';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { Address } from '@identity/addresses/entities/address.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * Xoá tài khoản trong app (D-14, E2E mobile 02/11).
 *
 * Google Play bắt app cho đăng ký tài khoản phải cho XOÁ tài khoản ngay trong
 * app; thiếu là bị từ chối khi nộp bản. Backend chưa có đường nào: chỉ admin
 * xoá được (`AdminService.deleteUser`), và cách đó GIỮ nguyên email, số điện
 * thoại, tên để admin khôi phục. Người dùng tự xoá thì dữ liệu cá nhân phải
 * đi thật.
 *
 * Luật bài kiểm khoá lại:
 *  - Tài khoản có mật khẩu phải gõ lại mật khẩu; tài khoản chỉ có Google thì
 *    không (họ không có mật khẩu nào để gõ).
 *  - Chặn khi còn đơn chưa xong (mua HOẶC bán), còn tiền ký quỹ đang giữ, hoặc
 *    ví còn tiền: xoá lúc đó là bỏ rơi người kia của đơn, hoặc nuốt tiền của
 *    chính người dùng.
 *  - Xoá xong: không đăng nhập lại được (khoá + xoá mềm + mọi phiên chết), tên
 *    email số điện thoại bị xoá trắng, shop đóng, hàng đang bán bị ẩn, địa chỉ
 *    bị xoá. Email gốc được trả lại, đăng ký lại bằng nó được.
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

const MAT_KHAU = 'matkhau123';

describe('Xoá tài khoản (D-14)', () => {
  let ds: DataSource;
  let svc: XoaTaiKhoanService;
  let ledger: LedgerService;
  let categoryId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [
        User,
        Address,
        Category,
        Product,
        Follow,
        Shop,
        Order,
        OrderItem,
        OrderShipment,
        Escrow,
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
      'addresses',
      'products',
      'follows',
      'shops',
      'categories',
      'users',
    ]) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-xtk')`);
    const [c] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM categories LIMIT 1',
    );
    categoryId = c.id;

    ledger = new LedgerService(ds);
    const products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      {
        create: () => Promise.resolve(undefined),
      } as unknown as NotificationsService,
      createCache({ ttl: 30_000 }),
      { phat: () => Promise.resolve() } as unknown as StockEventsService,
    );
    svc = new XoaTaiKhoanService(ds, products, ledger);
  });

  const taoUser = async (
    email: string,
    matKhau: string | null,
    role: UserRole = UserRole.BUYER,
  ): Promise<number> => {
    await ds.query(
      `INSERT INTO users (full_name, email, password, phone_number, role, refresh_token, token_version)
       VALUES ('Nguyen Van A', ?, ?, '0987654321', ?, 'hash-cu', 3)`,
      [email, matKhau === null ? '' : hashSync(matKhau, 4), role],
    );
    const [u] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    return Number(u.id);
  };

  const taoHang = async (sellerId: number, ten: string): Promise<number> => {
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, seller_id, category_id, status)
       VALUES (?, ?, 1000, 5, ?, ?, 'active')`,
      [ten, `${ten}-${sellerId}`, sellerId, categoryId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM products WHERE slug = ?',
      [`${ten}-${sellerId}`],
    );
    return Number(p.id);
  };

  const taoDon = async (
    buyerId: number,
    productId: number,
    status: string,
  ): Promise<number> => {
    const ma = `ORD-${buyerId}-${productId}-${status}`;
    await ds.query(
      `INSERT INTO orders (order_code, user_id, status, receiver_name, receiver_phone, shipping_address)
       VALUES (?, ?, ?, 'n', '0900000000', 'dc')`,
      [ma, buyerId, status],
    );
    const [o] = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM orders WHERE order_code = ?',
      [ma],
    );
    await ds.query(
      `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
       VALUES (?, ?, 'mon', 1000, 1, 1000)`,
      [o.id, productId],
    );
    return Number(o.id);
  };

  const loi = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as BadRequestException;
    }
    throw new Error('Mong đợi bị từ chối nhưng lại xoá được');
  };

  const conSong = async (id: number) => {
    const [u] = await ds.query<Array<{ deleted_at: Date | null }>>(
      'SELECT deleted_at FROM users WHERE id = ?',
      [id],
    );
    return u.deleted_at === null;
  };

  it('route là DELETE /auth/account', () => {
    expect(Reflect.getMetadata(PATH_METADATA, XoaTaiKhoanController)).toBe(
      'auth',
    );
    const handler = Object.getOwnPropertyDescriptor(
      XoaTaiKhoanController.prototype,
      'xoaTaiKhoan',
    )?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('account');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.DELETE,
    );
  });

  it('tài khoản có mật khẩu: thiếu hoặc sai mật khẩu thì không xoá', async () => {
    const u = await taoUser('a@t.local', MAT_KHAU);

    const thieu = await loi(svc.xoaTaiKhoan(u));
    expect(thieu).toBeInstanceOf(BadRequestException);
    const sai = await loi(svc.xoaTaiKhoan(u, 'sai-roi'));
    expect(sai).toBeInstanceOf(BadRequestException);
    expect(await conSong(u)).toBe(true);
  });

  it('tài khoản chỉ có Google: không cần mật khẩu', async () => {
    const u = await taoUser('g@t.local', null);
    await svc.xoaTaiKhoan(u);
    expect(await conSong(u)).toBe(false);
  });

  it('chặn khi còn đơn MUA chưa xong, nói rõ lý do', async () => {
    const ban = await taoUser('s@t.local', MAT_KHAU, UserRole.SELLER);
    const mua = await taoUser('b@t.local', MAT_KHAU);
    await taoDon(mua, await taoHang(ban, 'noi'), 'shipping');

    const e = await loi(svc.xoaTaiKhoan(mua, MAT_KHAU));
    expect(e).toBeInstanceOf(BadRequestException);
    const body = e.getResponse() as { message: string; reasons: string[] };
    expect(body.reasons).toContain('open_orders');
    expect(body.message).toMatch(/đơn/);
    expect(await conSong(mua)).toBe(true);
  });

  it('chặn khi còn đơn BÁN chưa xong, và không để hàng bị ẩn dở', async () => {
    const ban = await taoUser('s@t.local', MAT_KHAU, UserRole.SELLER);
    const mua = await taoUser('b@t.local', MAT_KHAU);
    const p = await taoHang(ban, 'noi');
    await taoHang(ban, 'chao');
    await taoDon(mua, p, 'pending');

    const e = await loi(svc.xoaTaiKhoan(ban, MAT_KHAU));
    const body = e.getResponse() as { reasons: string[] };
    expect(body.reasons).toContain('open_orders');
    expect(await conSong(ban)).toBe(true);
    const dangBan = await ds.query<unknown[]>(
      "SELECT id FROM products WHERE seller_id = ? AND status = 'active'",
      [ban],
    );
    expect(dangBan).toHaveLength(2);
  });

  it('đơn đã giao xong hoặc đã huỷ thì không chặn', async () => {
    const ban = await taoUser('s@t.local', MAT_KHAU, UserRole.SELLER);
    const mua = await taoUser('b@t.local', MAT_KHAU);
    await taoDon(mua, await taoHang(ban, 'noi'), 'delivered');
    await taoDon(mua, await taoHang(ban, 'chao'), 'cancelled');

    await svc.xoaTaiKhoan(mua, MAT_KHAU);
    expect(await conSong(mua)).toBe(false);
  });

  it('chặn khi ký quỹ của đơn còn đang giữ', async () => {
    const ban = await taoUser('s@t.local', MAT_KHAU, UserRole.SELLER);
    const mua = await taoUser('b@t.local', MAT_KHAU);
    const o = await taoDon(mua, await taoHang(ban, 'noi'), 'delivered');
    await ds.query(
      `INSERT INTO escrows (order_id, buyer_id, seller_id, amount, status)
       VALUES (?, ?, ?, 1000, 'holding')`,
      [o, mua, ban],
    );

    const e = await loi(svc.xoaTaiKhoan(ban, MAT_KHAU));
    const body = e.getResponse() as { reasons: string[] };
    expect(body.reasons).toContain('escrow_holding');
  });

  it('chặn khi ví còn tiền', async () => {
    const u = await taoUser('w@t.local', MAT_KHAU);
    const vi = await ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      u,
      LedgerPurpose.AVAILABLE,
    );
    const ngoai = await ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    await ledger.post({
      idempotencyKey: `xtk:${u}`,
      type: LedgerTxType.TOPUP,
      entries: [
        { accountId: Number(ngoai.id), amount: -50_000n },
        { accountId: Number(vi.id), amount: 50_000n },
      ],
    });

    const e = await loi(svc.xoaTaiKhoan(u, MAT_KHAU));
    const body = e.getResponse() as { message: string; reasons: string[] };
    expect(body.reasons).toContain('wallet_balance');
    expect(body.message).toMatch(/50\.000/);
  });

  it('quản trị viên không tự xoá được', async () => {
    const u = await taoUser('ad@t.local', MAT_KHAU, UserRole.ADMIN);
    await loi(svc.xoaTaiKhoan(u, MAT_KHAU));
    expect(await conSong(u)).toBe(true);
  });

  it('xoá xong: xoá trắng dữ liệu cá nhân, đóng shop, ẩn hàng, thu hồi phiên', async () => {
    const ban = await taoUser('seller-that@t.local', MAT_KHAU, UserRole.SELLER);
    await ds.query(
      `INSERT INTO shops (name, slug, status, user_id, phone, pickup_name, pickup_phone, pickup_address)
       VALUES ('Shop A', 'shop-a', 'active', ?, '0911111111', 'Nguyen Van A', '0911111111', 'So 1')`,
      [ban],
    );
    await ds.query(
      `INSERT INTO addresses (user_id, recipient_name, phone_number, province, district, street)
       VALUES (?, 'Nguyen Van A', '0987654321', 'HN', 'CG', 'So 1')`,
      [ban],
    );
    await taoHang(ban, 'noi');

    const kq = await svc.xoaTaiKhoan(ban, MAT_KHAU);
    expect(kq.message).toBeTruthy();

    const [u] = await ds.query<
      Array<{
        email: string;
        full_name: string;
        phone_number: string | null;
        avatar: string | null;
        is_locked: number;
        refresh_token: string | null;
        token_version: number;
        deleted_at: Date | null;
      }>
    >('SELECT * FROM users WHERE id = ?', [ban]);
    expect(u.deleted_at).not.toBeNull();
    expect(u.email).not.toContain('seller-that');
    expect(u.full_name).not.toContain('Nguyen');
    expect(u.phone_number).toBeNull();
    expect(u.avatar).toBeNull();
    expect(Number(u.is_locked)).toBe(1);
    expect(u.refresh_token).toBeNull();
    expect(Number(u.token_version)).toBe(4);

    const [shop] = await ds.query<
      Array<{
        status: string;
        phone: string | null;
        pickup_phone: string | null;
      }>
    >('SELECT status, phone, pickup_phone FROM shops WHERE user_id = ?', [ban]);
    expect(shop.status).toBe('inactive');
    expect(shop.phone).toBeNull();
    expect(shop.pickup_phone).toBeNull();

    const hang = await ds.query<Array<{ status: string }>>(
      'SELECT status FROM products WHERE seller_id = ?',
      [ban],
    );
    expect(hang.map((h) => h.status)).toEqual([ProductStatus.DRAFT]);

    const diaChi = await ds.query<unknown[]>(
      'SELECT id FROM addresses WHERE user_id = ?',
      [ban],
    );
    expect(diaChi).toHaveLength(0);

    // Email gốc được trả lại: đăng ký lại bằng nó không đụng khoá UNIQUE.
    await taoUser('seller-that@t.local', MAT_KHAU);
  });
});
