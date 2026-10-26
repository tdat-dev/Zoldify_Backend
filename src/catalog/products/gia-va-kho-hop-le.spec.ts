import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, FindOneOptions } from 'typeorm';
import { createCache } from 'cache-manager';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';
import { Product, ProductStatus } from './entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { OrdersService } from '@ordering/orders/orders.service';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { CreateOrderDto } from '@ordering/orders/dto/create-order.dto';
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
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { Setting } from '@ops/settings/entities/setting.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { PaymentMethod } from '@common/enums/payment.enum';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 1: giá, tồn kho và tổng tiền phải hợp lệ.
 *
 * Bốn lỗ đo được trên mã trước bản vá:
 *   · `CreateProductDto.price` chỉ có `@IsNumber`: đăng được món giá âm/0đ.
 *   · `stock` chỉ có `@IsNumber`: nhận 1.5 món, cột int thì MySQL tự làm tròn.
 *   · `PATCH /products/:id` ghi `stock` TUYỆT ĐỐI, đi vòng qua khoá lạc quan
 *     của `updateStock`: món vừa bán bị cộng ngược lại vào kho (đúng TC-P1-06,
 *     chỉ khác cửa vào).
 *   · `orders.create` không chặn đơn tổng 0đ (giá 0 có sẵn trong DB cũ).
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

async function loiCua(
  cls: new () => object,
  obj: Record<string, unknown>,
): Promise<string[]> {
  const loi = await validate(plainToInstance(cls, obj));
  return loi.map((e) => e.property);
}

describe('DTO sản phẩm: giá và tồn kho', () => {
  const hopLe = { name: 'Ao', price: 150_000, category_id: 1 };

  it('giá âm bị từ chối', async () => {
    expect(
      await loiCua(CreateProductDto, { ...hopLe, price: -1000 }),
    ).toContain('price');
  });

  it('giá 0 bị từ chối', async () => {
    expect(await loiCua(CreateProductDto, { ...hopLe, price: 0 })).toContain(
      'price',
    );
  });

  it('giá 1 và kho 0 vẫn hợp lệ', async () => {
    expect(
      await loiCua(CreateProductDto, { ...hopLe, price: 1, stock: 0 }),
    ).toEqual([]);
  });

  it('kho lẻ (1.5) bị từ chối', async () => {
    expect(await loiCua(CreateProductDto, { ...hopLe, stock: 1.5 })).toContain(
      'stock',
    );
  });

  it('kho âm bị từ chối', async () => {
    expect(await loiCua(CreateProductDto, { ...hopLe, stock: -1 })).toContain(
      'stock',
    );
  });

  it('PATCH cũng chặn giá 0 (UpdateProductDto kế thừa luật)', async () => {
    expect(await loiCua(UpdateProductDto, { price: 0 })).toContain('price');
  });
});

describe('Sửa tồn kho qua PATCH /products/:id và đơn 0đ', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let products: ProductsService;
  let buyerId: number;
  let sellerId: number;
  let categoryId: number;
  let productId: number;
  let phiShip = 30_000;

  const GIA = 100_000;
  const KHO = 50;

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
    sellerId = await taoUser('seller@t.local', UserRole.SELLER);
    await ds.query(
      `INSERT INTO categories (name, slug) VALUES ('Test', 'test-cat')`,
    );
    const [cat] = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM categories LIMIT 1`,
    );
    categoryId = cat.id;
    productId = await taoSanPham(GIA, KHO);
    phiShip = 30_000;

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
    const ghn = {
      calculateFee: () => Promise.resolve({ total: phiShip }),
    } as unknown as GhnService;
    const notifications = {
      create: () => Promise.resolve(undefined),
    } as unknown as NotificationsService;
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
      notifications,
      ghn,
      escrows,
      {
        voidOpenLinkForOrder: () => Promise.resolve(false),
      } as unknown as PayosService,
      {} as unknown as ShipmentTrackingService,
      ds,
      khoPhat,
    );
    products = new ProductsService(
      ds.getRepository(Product),
      ds.getRepository(Follow),
      ds.getRepository(Shop),
      notifications,
      createCache({ ttl: 30_000 }),
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

  async function taoSanPham(gia: number, kho: number): Promise<number> {
    const slug = `sp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, status, category_id, seller_id)
       VALUES ('Mon hang', ?, ?, ?, ?, ?, ?)`,
      [slug, gia, kho, ProductStatus.ACTIVE, categoryId, sellerId],
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
  const don = (): CreateOrderDto => ({
    shipping_address: 'so 1 duong A',
    receiver_name: 'Nguoi nhan',
    receiver_phone: '0900000000',
    payment_method: PaymentMethod.COD,
    ghn_district_id: 1442,
    ghn_ward_code: '20101',
  });
  const khoCua = async (pid: number): Promise<number> => {
    const [p] = await ds.query<Array<{ stock: number }>>(
      `SELECT stock FROM products WHERE id = ?`,
      [pid],
    );
    return Number(p.stock);
  };

  it('PATCH /products/:id đổi kho mà có đơn chen giữa thì 409, không cộng ngược món đã bán', async () => {
    const repo = ds.getRepository(Product);
    const goc = repo.findOne.bind(repo) as (
      o: FindOneOptions<Product>,
    ) => Promise<Product | null>;
    const spy = jest
      .spyOn(repo, 'findOne')
      .mockImplementationOnce(async (opts: FindOneOptions<Product>) => {
        const p = await goc(opts);
        // Ngay sau khi update() đọc xong (kho 50), có người mua 3 món.
        await themVaoGio(productId, 3);
        await orders.create(don(), nguoiMua());
        return p;
      });

    await expect(
      products.update(productId, { stock: 60 }, nguoiBan()),
    ).rejects.toThrow(/Tồn kho vừa thay đổi/);
    spy.mockRestore();

    expect(await khoCua(productId)).toBe(KHO - 3);
  });

  it('PATCH /products/:id kèm expected_stock lệch kho thật thì 409', async () => {
    await expect(
      products.update(
        productId,
        { stock: 60, expected_stock: 40 },
        nguoiBan(),
      ),
    ).rejects.toThrow(/Tồn kho vừa thay đổi/);
    expect(await khoCua(productId)).toBe(KHO);
  });

  it('PATCH /products/:id kèm expected_stock khớp thì đổi được kho', async () => {
    const moi = await products.update(
      productId,
      { stock: 60, expected_stock: KHO },
      nguoiBan(),
    );
    expect(Number(moi.stock)).toBe(60);
    expect(await khoCua(productId)).toBe(60);
  });

  it('đơn tổng 0đ (giá 0 có sẵn trong DB, phí ship 0) bị từ chối', async () => {
    const mienPhi = await taoSanPham(0, 5);
    phiShip = 0;
    await themVaoGio(mienPhi, 1);

    await expect(orders.create(don(), nguoiMua())).rejects.toThrow(
      /tổng tiền/i,
    );
    const [{ n }] = await ds.query<Array<{ n: number }>>(
      'SELECT COUNT(*) AS n FROM orders WHERE user_id = ?',
      [buyerId],
    );
    expect(Number(n)).toBe(0);
    expect(await khoCua(mienPhi)).toBe(5);
  });
});
