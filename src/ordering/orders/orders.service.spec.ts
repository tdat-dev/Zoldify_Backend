import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderShipment } from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { PaymentMethod } from '@common/enums/payment.enum';
import { IUser } from '@identity/users/users.interface';

// Docker chạy trong WSL thì localhost của Windows không thấy cổng 3307: đặt
// TEST_DB_HOST bằng IP của WSL (wsl hostname -I).
const TEST_DB_PLACEHOLDER = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: 'root',
  password: 'testpw',
  database: 'zoldify_test',
};

jest.setTimeout(60000);

describe('OrdersService.create - ton kho duoi tranh chap dong thoi', () => {
  let dataSource: DataSource;
  let service: OrdersService;
  let notificationsCreate: jest.Mock;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      host: TEST_DB_PLACEHOLDER.host,
      port: TEST_DB_PLACEHOLDER.port,
      username: TEST_DB_PLACEHOLDER.username,
      password: TEST_DB_PLACEHOLDER.password,
      database: TEST_DB_PLACEHOLDER.database,
      entities: [
        Order,
        OrderItem,
        OrderShipment,
        Cart,
        Product,
        Category,
        User,
      ],
      synchronize: true,
      logging: false,
    });

    try {
      await dataSource.initialize();
    } catch (err) {
      throw new Error(
        'Khong ket noi duoc MySQL cho test. Xem huong dan container test trong src/money/ledger/ledger.service.spec.ts. Loi goc: ' +
          (err as Error).message,
      );
    }
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    notificationsCreate = jest.fn().mockResolvedValue(undefined);

    service = new OrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderItem),
      dataSource.getRepository(OrderShipment),
      {} as any,
      dataSource.getRepository(Cart),
      dataSource.getRepository(Product),
      dataSource.getRepository(User),
      { create: notificationsCreate } as any,
      {} as any,
      {} as any,
      {} as any,
      dataSource,
    );

    await dataSource.query('DELETE FROM order_items');
    await dataSource.query('DELETE FROM order_shipments');
    await dataSource.query('DELETE FROM orders');
    await dataSource.query('DELETE FROM carts');
    await dataSource.query('DELETE FROM products');
    await dataSource.query('DELETE FROM users');
  });

  async function makeBuyerAndSeller() {
    const users = dataSource.getRepository(User);
    const seller = await users.save(
      users.create({
        full_name: 'Nguoi ban',
        email: 'seller-' + Date.now() + '-' + Math.random() + '@test.local',
        password: 'x',
        role: UserRole.SELLER,
      }),
    );
    const buyer = await users.save(
      users.create({
        full_name: 'Nguoi mua',
        email: 'buyer-' + Date.now() + '-' + Math.random() + '@test.local',
        password: 'x',
        role: UserRole.BUYER,
      }),
    );
    return { seller: seller, buyer: buyer };
  }

  async function makeProduct(sellerId: number, stock: number) {
    const products = dataSource.getRepository(Product);
    return products.save(
      products.create({
        name: 'San pham test',
        price: 100000,
        stock: stock,
        status: ProductStatus.ACTIVE,
        seller: { id: sellerId } as User,
      }),
    );
  }

  async function addToCart(
    buyerId: number,
    productId: number,
    quantity: number,
  ) {
    const carts = dataSource.getRepository(Cart);
    return carts.save(
      carts.create({
        user: { id: buyerId } as User,
        product: { id: productId } as Product,
        quantity: quantity,
      }),
    );
  }

  function asIUser(user: User): IUser {
    return {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    };
  }

  function makeDto(): any {
    return {
      shipping_address: '123 duong test',
      receiver_name: 'Nguoi nhan',
      receiver_phone: '0900000000',
      payment_method: PaymentMethod.COD,
    };
  }

  it('mot don dat dung so luong ton kho thi tru kho dung mot lan', async () => {
    const pair = await makeBuyerAndSeller();
    const product = await makeProduct(pair.seller.id, 5);
    await addToCart(pair.buyer.id, product.id, 3);

    await service.create(makeDto(), asIUser(pair.buyer));

    const reloaded = await dataSource.getRepository(Product).findOne({
      where: { id: product.id },
    });
    expect(reloaded).not.toBeNull();
    expect((reloaded as Product).stock).toBe(2);
  });

  it('dat nhieu hon ton kho bi tu choi va khong tru kho', async () => {
    const pair = await makeBuyerAndSeller();
    const product = await makeProduct(pair.seller.id, 1);
    await addToCart(pair.buyer.id, product.id, 5);

    await expect(
      service.create(makeDto(), asIUser(pair.buyer)),
    ).rejects.toBeInstanceOf(BadRequestException);

    const reloaded = await dataSource.getRepository(Product).findOne({
      where: { id: product.id },
    });
    expect(reloaded).not.toBeNull();
    expect((reloaded as Product).stock).toBe(1);
  });

  it('hai nguoi mua tranh nhau don vi ton kho cuoi cung: chi mot nguoi thang, kho khong bao gio am', async () => {
    const pair = await makeBuyerAndSeller();
    const product = await makeProduct(pair.seller.id, 1);

    const users = dataSource.getRepository(User);
    const buyer2 = await users.save(
      users.create({
        full_name: 'Nguoi mua 2',
        email: 'buyer2-' + Date.now() + '-' + Math.random() + '@test.local',
        password: 'x',
        role: UserRole.BUYER,
      }),
    );

    await addToCart(pair.buyer.id, product.id, 1);
    await addToCart(buyer2.id, product.id, 1);

    const results = await Promise.allSettled([
      service.create(makeDto(), asIUser(pair.buyer)),
      service.create(makeDto(), asIUser(buyer2)),
    ]);

    const fulfilled = results.filter(function (r) {
      return r.status === 'fulfilled';
    });
    const rejected = results.filter(function (r) {
      return r.status === 'rejected';
    });

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedReason).toBeInstanceOf(BadRequestException);

    const reloaded = await dataSource.getRepository(Product).findOne({
      where: { id: product.id },
    });
    expect(reloaded).not.toBeNull();
    expect((reloaded as Product).stock).toBe(0);

    const orderCount = await dataSource.getRepository(Order).count();
    expect(orderCount).toBe(1);

    const itemCount = await dataSource.getRepository(OrderItem).count();
    expect(itemCount).toBe(1);

    expect(notificationsCreate).toHaveBeenCalledTimes(1);
  });

  it('sap giua transaction thi khong de lai don moi coi va khong tru kho', async () => {
    const pair = await makeBuyerAndSeller();
    const product = await makeProduct(pair.seller.id, 4);
    await addToCart(pair.buyer.id, product.id, 2);

    // Gài vào prototype chứ không vào dataSource.getRepository(Cart): trong
    // transaction, create() xoá giỏ qua manager.getRepository(Cart), một
    // repository KHÁC. Lần gọi delete đầu tiên sau đây chính là lệnh xoá giỏ,
    // bước ghi cuối cùng trong transaction.
    const deleteSpy = jest
      .spyOn(Repository.prototype, 'delete')
      .mockImplementationOnce(() => {
        throw new Error('mo phong sap giua chung');
      });

    await expect(
      service.create(makeDto(), asIUser(pair.buyer)),
    ).rejects.toThrow('mo phong sap giua chung');
    deleteSpy.mockRestore();

    const orderCount = await dataSource.getRepository(Order).count();
    const itemCount = await dataSource.getRepository(OrderItem).count();
    const reloaded = await dataSource.getRepository(Product).findOne({
      where: { id: product.id },
    });

    expect(orderCount).toBe(0);
    expect(itemCount).toBe(0);
    expect(reloaded).not.toBeNull();
    expect((reloaded as Product).stock).toBe(4);
  });
});
