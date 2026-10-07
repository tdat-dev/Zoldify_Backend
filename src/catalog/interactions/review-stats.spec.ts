import { DataSource } from 'typeorm';
import { InteractionsService } from './interactions.service';
import { Review } from './entities/review.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';

/**
 * Lỗi H-01 của đợt test E2E Android 30/09 — bài kiểm viết TRƯỚC.
 *
 * App hiện điểm sao, số đánh giá, "đã bán", "% phản hồi" bằng số SINH NGẪU
 * NHIÊN theo id (mobile src/features/reviews/mock.ts), còn bảng `reviews` trên
 * prod có 0 dòng. Backend có API đánh giá chặt chẽ (phải mua và nhận hàng mới
 * được viết) nhưng không có số tổng hợp nào để app đọc: Product không có cột
 * điểm, không có thống kê người bán.
 *
 * Kèm một lỗ hổng tìm ra khi soát: GET /interactions/product/:id là @Public và
 * trả nguyên `user` của người đánh giá, gồm email và số điện thoại.
 *
 * Chạy trên MySQL thật (npm run test:db): phép tính trung bình, loại đánh giá
 * đã xoá mềm, cộng dồn theo người bán là SQL, mock không chứng minh được.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('Đánh giá: số tổng hợp thật cho sản phẩm và người bán', () => {
  let ds: DataSource;
  let svc: InteractionsService;
  let sellerId: number;
  let productId: number;
  let buyers: number[];
  let orderOf: Map<number, number>;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [
        Review,
        Product,
        Category,
        User,
        Order,
        OrderItem,
        OrderShipment,
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
    svc = new InteractionsService(
      ds.getRepository(User),
      ds.getRepository(Product),
      ds.getRepository(Review),
      ds.getRepository(Order),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  beforeEach(async () => {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['reviews', 'order_items', 'orders', 'products', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role, phone_number)
       VALUES ('Người bán', 'seller@t.local', 'x', 'seller', '0911111111')`,
    );
    sellerId = await idVuaChen();
    await ds.query(
      `INSERT INTO products (name, slug, price, stock, seller_id, sold_count)
       VALUES ('Bếp từ', 'bep-tu-test', 1890000, 5, ?, 7)`,
      [sellerId],
    );
    productId = await idVuaChen();

    // Hai người mua, mỗi người một đơn ĐÃ GIAO có món này: điều kiện để được
    // viết đánh giá (InteractionsService.create kiểm đúng điều đó).
    buyers = [];
    orderOf = new Map();
    for (const n of [1, 2]) {
      await ds.query(
        `INSERT INTO users (full_name, email, password, role, phone_number)
         VALUES (?, ?, 'x', 'buyer', ?)`,
        [`Người mua ${n}`, `buyer${n}@t.local`, `090000000${n}`],
      );
      const uid = await idVuaChen();
      buyers.push(uid);
      await ds.query(
        `INSERT INTO orders (order_code, user_id, final_amount, status,
                             receiver_name, receiver_phone, shipping_address)
         VALUES (?, ?, 1890000, 'delivered', 'N', '0900000000', 'So 1')`,
        [`ORD-RV-${n}`, uid],
      );
      const oid = await idVuaChen();
      orderOf.set(uid, oid);
      await ds.query(
        `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
         VALUES (?, ?, 'Bếp từ', 1890000, 1, 1890000)`,
        [oid, productId],
      );
    }
  });

  const asUser = (id: number) => ({ id, role: 'buyer' }) as never;

  async function viet(uid: number, rating: number) {
    return svc.create(
      {
        product_id: productId,
        order_id: orderOf.get(uid)!,
        rating,
        comment: 'ok',
      },
      asUser(uid),
    );
  }

  async function soLieu() {
    const rows = await ds.query<
      Array<{ rating_avg: string | number; review_count: string | number }>
    >('SELECT rating_avg, review_count FROM products WHERE id = ?', [
      productId,
    ]);
    return {
      rating: Number(rows[0].rating_avg),
      count: Number(rows[0].review_count),
    };
  }

  it('hai đánh giá 5 và 4 sao: sản phẩm có điểm 4,5 và 2 lượt', async () => {
    await viet(buyers[0], 5);
    await viet(buyers[1], 4);
    expect(await soLieu()).toEqual({ rating: 4.5, count: 2 });
  });

  it('xoá một đánh giá thì số liệu tính lại, không đếm bản đã xoá mềm', async () => {
    const r = await viet(buyers[0], 5);
    await viet(buyers[1], 3);
    await svc.remove(r.id, asUser(buyers[0]));
    expect(await soLieu()).toEqual({ rating: 3, count: 1 });
  });

  // Test máy ảo 07/10: xoá đánh giá rồi viết lại thì POST /interactions trả 500.
  // Khoá UNIQUE idx_user_product vẫn giữ dòng đã xoá mềm, còn bước kiểm "đã
  // đánh giá chưa" bỏ qua dòng đó, nên INSERT đâm vào khoá (ER_DUP_ENTRY).
  it('xoá đánh giá rồi viết lại: lưu được, số liệu chỉ tính bản mới', async () => {
    const r = await viet(buyers[0], 2);
    await svc.remove(r.id, asUser(buyers[0]));
    const moi = await viet(buyers[0], 5);
    expect(moi.rating).toBe(5);
    expect(await soLieu()).toEqual({ rating: 5, count: 1 });
  });

  it('đánh giá chưa xoá thì vẫn chặn viết lần hai (400, không phải 500)', async () => {
    await viet(buyers[0], 4);
    await expect(viet(buyers[0], 5)).rejects.toThrow('Bạn đã đánh giá sản phẩm này rồi');
  });

  it('sửa số sao thì điểm sản phẩm đổi theo', async () => {
    const r = await viet(buyers[0], 2);
    await svc.update(r.id, { rating: 5 }, asUser(buyers[0]));
    expect(await soLieu()).toEqual({ rating: 5, count: 1 });
  });

  it('thống kê người bán: điểm theo lượt đánh giá, số đánh giá, đã bán', async () => {
    await viet(buyers[0], 5);
    await viet(buyers[1], 4);
    const s = await svc.sellerStats(sellerId);
    // "Đã bán" đếm từ đơn ĐÃ GIAO (2 đơn x 1 món), không đọc products.sold_count:
    // cột đó không có dòng mã nào ghi (soát 06/10), seed để 7 ở đây cố ý sai.
    expect(s).toEqual({ rating: 4.5, review_count: 2, sold_count: 2 });
  });

  it('đơn chưa giao hoặc đã huỷ không tính vào "đã bán"', async () => {
    await ds.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [
      orderOf.get(buyers[1]),
    ]);
    const s = await svc.sellerStats(sellerId);
    expect(s.sold_count).toBe(1);
  });

  it('API công khai không trả email, số điện thoại của người đánh giá', async () => {
    await viet(buyers[0], 5);
    const page = await svc.findByProduct(productId, '1', '10');
    const u = page.result[0].user as unknown as Record<string, unknown>;
    expect(u.full_name).toBe('Người mua 1');
    expect(u.email).toBeUndefined();
    expect(u.phone_number).toBeUndefined();
  });

  // Review 06/10: GET /interactions và GET /interactions/:id chỉ cần đăng nhập,
  // nhưng cũng trả nguyên User. Một tài khoản bất kỳ gọi GET /interactions (bỏ
  // `mine`) là gom được email, số điện thoại của mọi người từng đánh giá.
  it('danh sách đánh giá (đã đăng nhập) cũng không lộ email, số điện thoại', async () => {
    await viet(buyers[0], 5);
    const page = await svc.findAll('1', '10', asUser(buyers[1]));
    const u = page.result[0].user as unknown as Record<string, unknown>;
    expect(u.full_name).toBe('Người mua 1');
    expect(u.email).toBeUndefined();
    expect(u.phone_number).toBeUndefined();
  });

  it('xem một đánh giá theo id cũng không lộ email, số điện thoại', async () => {
    const r = await viet(buyers[0], 5);
    const one = await svc.findOne(r.id);
    const u = one.user as unknown as Record<string, unknown>;
    expect(u.email).toBeUndefined();
    expect(u.phone_number).toBeUndefined();
  });
});
