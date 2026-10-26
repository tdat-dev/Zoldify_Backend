import { DataSource, FindManyOptions } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderShipment } from './entities/order-shipment.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { Cart } from '@ordering/carts/entities/cart.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 10: header Idempotency-Key cho POST /orders.
 *
 * Khoá chống trùng hiện có băm từ id các dòng giỏ hàng, nên nó chặn được hai
 * lượt bấm CÙNG LÚC. Nó không chặn được lượt GỬI LẠI SAU KHI lượt đầu đã
 * commit: lúc đó giỏ đã bị xoá, lượt gửi lại đọc giỏ rỗng và nhận "Giỏ hàng
 * trống, không thể tạo đơn hàng". Mạng di động rớt đúng lúc nhận phản hồi là
 * kịch bản thường gặp: đơn đã có, app báo lỗi, người mua tưởng chưa đặt được.
 *
 * Có header thì lượt gửi lại nhận đúng đơn đầu.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

type TaoDon = (
  dto: CreateOrderDto,
  user: IUser,
  khoa?: string,
) => Promise<Order>;

describe('POST /orders với Idempotency-Key', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let buyerId: number;
  let buyer2Id: number;
  let sellerId: number;
  let productId: number;

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
    buyer2Id = await taoUser('buyer2@t.local', UserRole.BUYER);
    sellerId = await taoUser('seller@t.local', UserRole.SELLER);
    await ds.query(`INSERT INTO categories (name, slug) VALUES ('c', 'c-ik')`);
    const [c] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('Mon', 'mon-ik', 100000, 50, ?, ?, ?)`,
      [ProductStatus.ACTIVE, c.id, sellerId],
    );
    const [p] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM products WHERE slug = 'mon-ik'`,
    );
    productId = p.id;

    const ledger = new LedgerService(ds);
    orders = new OrdersService(
      ds.getRepository(Order),
      ds.getRepository(OrderItem),
      ds.getRepository(OrderShipment),
      ds.getRepository(Shop),
      ds.getRepository(Cart),
      ds.getRepository(Product),
      ds.getRepository(User),
      { create: () => Promise.resolve(undefined) } as never,
      { calculateFee: () => Promise.resolve({ total: 30_000 }) } as never,
      new EscrowsService(
        ds.getRepository(Escrow),
        ds.getRepository(User),
        ds.getRepository(Order),
        ds.getRepository(OrderItem),
        ds,
        ledger,
        new PlatformFeeService(ds),
      ),
      { voidOpenLinkForOrder: () => Promise.resolve(false) } as never,
      {} as never,
      ds,
      { phat: () => Promise.resolve() } as never,
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

  const ai = (id: number): IUser => ({
    id,
    full_name: 'b',
    email: `${id}@t.local`,
    role: UserRole.BUYER,
    avatar: '',
  });
  const don = (): CreateOrderDto => ({
    shipping_address: 'so 1',
    receiver_name: 'N',
    receiver_phone: '0900000000',
    payment_method: PaymentMethod.COD,
    ghn_district_id: 1442,
    ghn_ward_code: '20101',
  });
  const gioCua = (uid: number, qty = 1) =>
    ds.query(
      `INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)`,
      [uid, productId, qty],
    );
  const taoDon = (dto: CreateOrderDto, user: IUser, khoa?: string) =>
    (orders as unknown as { create: TaoDon }).create(dto, user, khoa);
  const soDon = async () =>
    Number(
      (
        await ds.query<Array<{ n: number }>>('SELECT COUNT(*) AS n FROM orders')
      )[0].n,
    );

  it('gửi lại cùng Idempotency-Key SAU khi đơn đã commit: nhận lại đơn đầu, không "Giỏ hàng trống"', async () => {
    await gioCua(buyerId, 2);
    const dau = await taoDon(don(), ai(buyerId), 'app-7f3a-001');

    const lai = await taoDon(don(), ai(buyerId), 'app-7f3a-001');

    expect(lai.id).toBe(dau.id);
    expect(await soDon()).toBe(1);
  });

  it('cùng chuỗi khoá nhưng NGƯỜI KHÁC: không trả đơn của người kia', async () => {
    await gioCua(buyerId);
    const cuaA = await taoDon(don(), ai(buyerId), 'trung-khoa');
    await gioCua(buyer2Id);

    const cuaB = await taoDon(don(), ai(buyer2Id), 'trung-khoa');

    expect(cuaB.id).not.toBe(cuaA.id);
    expect(await soDon()).toBe(2);
  });

  it('khoá dài quá 100 ký tự thì 400', async () => {
    await gioCua(buyerId);
    await expect(taoDon(don(), ai(buyerId), 'x'.repeat(101))).rejects.toThrow(
      /Idempotency-Key/,
    );
    expect(await soDon()).toBe(0);
  });

  /**
   * Review 26/10 mục 2. Hai lượt CÙNG khoá chạy song song trên món CUỐI CÙNG:
   * lượt B đứng chờ khoá dòng sản phẩm tới khi A commit, rồi đọc lại kho dưới
   * khoá thấy 0 và ném "chỉ còn 0" trước khi kịp tới câu INSERT (nơi khoá
   * UNIQUE sẽ cho nó nhận lại đơn của A). Người mua gửi lại đúng như luật
   * Idempotency-Key mà vẫn nhận lỗi hết hàng.
   */
  it('hai lượt cùng khoá song song trên món cuối cùng: cả hai nhận CÙNG một đơn', async () => {
    await ds.query('UPDATE products SET stock = 1 WHERE id = ?', [productId]);
    await gioCua(buyerId, 1);

    const [a, b] = await Promise.all([
      taoDon(don(), ai(buyerId), 'mon-cuoi-1'),
      taoDon(don(), ai(buyerId), 'mon-cuoi-1'),
    ]);

    expect(a.id).toBe(b.id);
    expect(await soDon()).toBe(1);
  });

  it('lượt gửi lại đọc giỏ SAU khi lượt đầu đã xoá giỏ: nhận đơn đầu, không "Giỏ hàng trống"', async () => {
    await gioCua(buyerId, 1);
    const gioRepo = ds.getRepository(Cart);
    const goc = gioRepo.find.bind(gioRepo) as (
      o: FindManyOptions<Cart>,
    ) => Promise<Cart[]>;
    let dau: Order | undefined;
    // Lượt B qua bước tra khoá lúc đơn A CHƯA có; ngay trước khi B đọc giỏ,
    // A chạy trọn vẹn và xoá giỏ.
    const spy = jest
      .spyOn(gioRepo, 'find')
      .mockImplementationOnce(async (o: FindManyOptions<Cart>) => {
        dau = await taoDon(don(), ai(buyerId), 'gio-da-xoa');
        return goc(o);
      });

    const lai = await taoDon(don(), ai(buyerId), 'gio-da-xoa');
    spy.mockRestore();

    expect(lai.id).toBe(dau?.id);
    expect(await soDon()).toBe(1);
  });

  /**
   * Review 26/10 mục 8. Đơn đã xoá mềm vẫn giữ khoá trong
   * `uq_order_user_client_key`, nhưng `findOne` thường lọc `deleted_at`: tra
   * khoá hụt, câu INSERT đụng UNIQUE, lượt tra lại cũng hụt, và người dùng
   * nhận QueryFailedError thành 500.
   */
  it('khoá đã dùng cho một đơn đã xoá mềm: 409 nói rõ, không 500, không tạo đơn', async () => {
    await gioCua(buyerId, 1);
    const cu = await taoDon(don(), ai(buyerId), 'khoa-don-da-xoa');
    await ds.query(
      `UPDATE orders SET status = 'cancelled', deleted_at = NOW(6) WHERE id = ?`,
      [cu.id],
    );
    await gioCua(buyerId, 1);

    const loi = await taoDon(don(), ai(buyerId), 'khoa-don-da-xoa').catch(
      (e: unknown) => e,
    );

    expect(loi).toBeInstanceOf(ConflictException);
    expect((loi as Error).message).toMatch(/Idempotency-Key/);
    expect(await soDon()).toBe(1);
  });

  it('đối chứng: không gửi khoá thì gửi lại sau commit vẫn báo giỏ trống như cũ', async () => {
    await gioCua(buyerId);
    await taoDon(don(), ai(buyerId));
    await expect(taoDon(don(), ai(buyerId))).rejects.toThrow(/Giỏ hàng trống/);
  });
});
