import { DataSource, Repository } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { ShipmentTrackingService } from './shipment-tracking.service';
import {
  OrderShipment,
  ShipmentStatus,
} from './entities/order-shipment.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { User } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { GhnService } from '@ordering/ghn/ghn.service';

/**
 * Webhook GHN (task #26, AD-03 ô T3) — bài kiểm viết TRƯỚC.
 *
 * VÌ SAO ĐƯỜNG NÀY NGUY HIỂM HƠN MỌI ENDPOINT KHÁC.
 *
 * Webhook là endpoint CÔNG KHAI, không có JWT — GHN gọi vào chứ không phải
 * người dùng. Và thứ nó làm là đánh dấu lô hàng "đã giao", mà `delivered_at`
 * chính là mốc để `autoConfirmDueShipments` đếm cửa sổ rồi **giải ngân escrow
 * cho người bán**. Nói cách khác: ai giả được webhook này thì sau N ngày là
 * rút được tiền người mua đang ký quỹ, không cần đăng nhập.
 *
 * Nên bài kiểm này hỏi đúng những câu đó, và câu quan trọng nhất là câu cuối
 * cùng: hệ thống có tin lời webhook nói không.
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

jest.setTimeout(60_000);

const TOKEN = 'token-bi-mat-cua-test';

describe('ShipmentTrackingService — webhook GHN', () => {
  let ds: DataSource;
  let repo: Repository<OrderShipment>;
  let svc: ShipmentTrackingService;

  /** Trạng thái mà GHN sẽ trả khi bị hỏi lại. Mỗi test tự đặt. */
  let ghnTraVe: string | null;
  /** Đếm số lần service hỏi lại GHN — dùng để chứng minh nó KHÔNG tin thân request. */
  let soLanHoiGhn: number;

  let orderId: number;
  let sellerId: number;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [OrderShipment, Order, OrderItem, User, Product, Category],
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
    repo = ds.getRepository(OrderShipment);

    // GhnService giả: chỉ cần đúng một phương thức mà service này gọi. Bài kiểm
    // hỏi "hệ thống xử lý ra sao", không hỏi "GHN trả lời thế nào".
    const ghnGia = {
      getOrderStatus: async () => {
        soLanHoiGhn += 1;
        return ghnTraVe;
      },
    } as unknown as GhnService;

    process.env.GHN_WEBHOOK_TOKEN = TOKEN;
    svc = new ShipmentTrackingService(repo, ghnGia);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    ghnTraVe = 'delivered';
    soLanHoiGhn = 0;

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['order_shipments', 'order_items', 'orders', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('s','s@t.local','x','seller')`,
    );
    sellerId = (await ds.query('SELECT LAST_INSERT_ID() AS id'))[0].id;
    // receiver_* và shipping_address là NOT NULL không mặc định — bỏ sót thì
    // lỗi "Field 'receiver_name' doesn't have a default value", và lỗi đó nói
    // về bài kiểm chứ không về mã đang kiểm.
    await ds.query(
      `INSERT INTO orders (order_code, user_id, final_amount, status,
                           receiver_name, receiver_phone, shipping_address)
       VALUES ('ORD-1', ?, 100000, 'shipping', 'Nguoi Nhan', '0900000000', 'So 1')`,
      [sellerId],
    );
    orderId = (await ds.query('SELECT LAST_INSERT_ID() AS id'))[0].id;
  });

  /**
   * Tạo một lô hàng ở trạng thái cho trước.
   *
   * Mỗi lô một NGƯỜI BÁN KHÁC NHAU: `uq_shipment_order_seller` là UNIQUE
   * (order_id, seller_id) — đúng thiết kế, mỗi người bán trong đơn chỉ có một
   * lô. Dùng chung một seller cho hai lô là dựng dữ liệu không tồn tại được
   * ngoài đời, và ràng buộc đã bắt đúng lúc viết bài kiểm này.
   */
  async function taoLo(status = ShipmentStatus.CREATED, ma = 'GHN123') {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ('s', ?, 'x', 'seller')`,
      [`s-${ma}@t.local`],
    );
    const sid = (await ds.query('SELECT LAST_INSERT_ID() AS id'))[0].id;
    await ds.query(
      `INSERT INTO order_shipments (order_id, seller_id, tracking_code, cod_amount, status)
       VALUES (?, ?, ?, 0, ?)`,
      [orderId, sid, ma, status],
    );
    const id = (await ds.query('SELECT LAST_INSERT_ID() AS id'))[0].id;
    return repo.findOneByOrFail({ id });
  }

  const doc = (id: number) => repo.findOneByOrFail({ id });

  // ── W1: token ────────────────────────────────────────────────────────────
  it('token sai thì từ chối, và KHÔNG đụng vào lô hàng', async () => {
    const lo = await taoLo();

    await expect(svc.xuLyWebhook('token-bay-ba', { OrderCode: 'GHN123' })).rejects.toThrow(
      UnauthorizedException,
    );

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.CREATED);
    expect(sau.delivered_at).toBeNull();
    // Không được gọi GHN: chưa qua cửa token thì không tốn một request nào.
    expect(soLanHoiGhn).toBe(0);
  });

  it('thiếu token cũng bị từ chối', async () => {
    await taoLo();
    await expect(svc.xuLyWebhook(undefined, { OrderCode: 'GHN123' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── Đường đi đúng ────────────────────────────────────────────────────────
  it('token đúng + GHN xác nhận đã giao → chuyển DELIVERED, ghi delivered_at', async () => {
    const lo = await taoLo();
    ghnTraVe = 'delivered';

    const kq = await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.DELIVERED);
    expect(sau.delivered_at).toBeInstanceOf(Date);
    expect(kq.updated).toBe(true);
  });

  // ── W1 (phần cốt lõi): KHÔNG tin thân request ────────────────────────────
  it('webhook NÓI đã giao mà GHN bảo chưa → không đổi gì', async () => {
    const lo = await taoLo();
    // Kẻ giả mạo gửi đúng thứ nó muốn hệ thống tin.
    ghnTraVe = 'delivering';

    const kq = await svc.xuLyWebhook(TOKEN, {
      OrderCode: 'GHN123',
      Status: 'delivered',
    });

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.CREATED);
    expect(sau.delivered_at).toBeNull();
    expect(kq.updated).toBe(false);
    // Bằng chứng nó đã đi hỏi lại thay vì đọc thân request.
    expect(soLanHoiGhn).toBe(1);
  });

  // ── W2: gọi lại nhiều lần ────────────────────────────────────────────────
  it('GHN gửi lại lần hai → không đổi gì thêm (idempotent)', async () => {
    const lo = await taoLo();

    await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });
    const lan1 = await doc(lo.id);

    const kq2 = await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });
    const lan2 = await doc(lo.id);

    expect(kq2.updated).toBe(false);
    expect(lan2.status).toBe(ShipmentStatus.DELIVERED);
    expect(lan2.delivered_at!.getTime()).toBe(lan1.delivered_at!.getTime());
  });

  // ── W3: webhook tới sai thứ tự ───────────────────────────────────────────
  it('lô đã RECEIVED thì webhook KHÔNG kéo ngược về DELIVERED', async () => {
    const lo = await taoLo(ShipmentStatus.RECEIVED);

    const kq = await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.RECEIVED);
    expect(kq.updated).toBe(false);
  });

  // ── W5: mã lạ ────────────────────────────────────────────────────────────
  it('mã vận đơn không có trong hệ thống → không ném, trả về đã nhận', async () => {
    const kq = await svc.xuLyWebhook(TOKEN, { OrderCode: 'KHONG-CO-THAT' });
    expect(kq.updated).toBe(false);
    expect(kq.known).toBe(false);
    // Không đi hỏi GHN về một mã mình không quản lý.
    expect(soLanHoiGhn).toBe(0);
  });

  it('thân request thiếu mã vận đơn → không ném', async () => {
    const kq = await svc.xuLyWebhook(TOKEN, {});
    expect(kq.known).toBe(false);
  });

  // ── W4: cron poll và webhook dùng CHUNG một đường ────────────────────────
  it('đồng bộ định kỳ dùng cùng hàm chuyển trạng thái với webhook', async () => {
    const lo = await taoLo();
    ghnTraVe = 'delivered';

    const kq = await svc.dongBoTatCa();

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.DELIVERED);
    expect(sau.delivered_at).toBeInstanceOf(Date);
    expect(kq).toEqual({ checked: 1, delivered: 1 });
  });

  it('đồng bộ định kỳ bỏ qua lô đã RECEIVED, không kéo ngược', async () => {
    const lo = await taoLo(ShipmentStatus.RECEIVED);
    const kq = await svc.dongBoTatCa();
    expect((await doc(lo.id)).status).toBe(ShipmentStatus.RECEIVED);
    expect(kq.delivered).toBe(0);
  });

  it('một lô lỗi không làm chết cả lượt đồng bộ', async () => {
    await taoLo(ShipmentStatus.CREATED, 'GHN-HONG');
    await taoLo(ShipmentStatus.CREATED, 'GHN-OK');

    let lan = 0;
    (svc as any).ghn = {
      getOrderStatus: async () => {
        lan += 1;
        if (lan === 1) throw new Error('GHN 500');
        return 'delivered';
      },
    };

    const kq = await svc.dongBoTatCa();
    expect(kq.checked).toBe(2);
    expect(kq.delivered).toBe(1);
  });
});
