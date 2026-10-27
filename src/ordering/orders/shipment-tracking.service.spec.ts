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
  /** GhnService giả gốc, để mỗi test bắt đầu lại từ nó sau khi có test thay. */
  let ghnGoc: GhnService;

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
      getOrderStatus: () => {
        soLanHoiGhn += 1;
        return Promise.resolve(ghnTraVe);
      },
    } as unknown as GhnService;

    process.env.GHN_WEBHOOK_TOKEN = TOKEN;
    ghnGoc = ghnGia;
    svc = new ShipmentTrackingService(repo, ghnGia);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(async () => {
    ghnTraVe = 'delivered';
    soLanHoiGhn = 0;
    (svc as unknown as { ghn: GhnService }).ghn = ghnGoc;

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['order_shipments', 'order_items', 'orders', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('s','s@t.local','x','seller')`,
    );
    sellerId = await idVuaChen();
    // receiver_* và shipping_address là NOT NULL không mặc định — bỏ sót thì
    // lỗi "Field 'receiver_name' doesn't have a default value", và lỗi đó nói
    // về bài kiểm chứ không về mã đang kiểm.
    await ds.query(
      `INSERT INTO orders (order_code, user_id, final_amount, status,
                           receiver_name, receiver_phone, shipping_address)
       VALUES ('ORD-1', ?, 100000, 'shipping', 'Nguoi Nhan', '0900000000', 'So 1')`,
      [sellerId],
    );
    orderId = await idVuaChen();
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
    const sid = await idVuaChen();
    await ds.query(
      `INSERT INTO order_shipments (order_id, seller_id, tracking_code, cod_amount, status)
       VALUES (?, ?, ?, 0, ?)`,
      [orderId, sid, ma, status],
    );
    const id = await idVuaChen();
    return repo.findOneByOrFail({ id });
  }

  const doc = (id: number) => repo.findOneByOrFail({ id });

  /**
   * `ds.query` trả `any`, nên đọc thẳng `[0].id` là bốn lỗi lint
   * unsafe-member-access. Bắt kiểu một lần ở đây thay vì rải khắp nơi.
   *
   * Dùng THAM SỐ KIỂU của `query<T>()` chứ không `as Array<{id:number}>`:
   * `eslint --fix` coi phép ép từ `any` là thừa và gỡ mất, nên viết kiểu đó là
   * lần chạy lint sau tự xoá rồi lỗi quay lại.
   */
  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  // ── W1: token ────────────────────────────────────────────────────────────
  it('token sai thì từ chối, và KHÔNG đụng vào lô hàng', async () => {
    const lo = await taoLo();

    await expect(
      svc.xuLyWebhook('token-bay-ba', { OrderCode: 'GHN123' }),
    ).rejects.toThrow(UnauthorizedException);

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.CREATED);
    expect(sau.delivered_at).toBeNull();
    // Không được gọi GHN: chưa qua cửa token thì không tốn một request nào.
    expect(soLanHoiGhn).toBe(0);
  });

  it('thiếu token cũng bị từ chối', async () => {
    await taoLo();
    await expect(
      svc.xuLyWebhook(undefined, { OrderCode: 'GHN123' }),
    ).rejects.toThrow(UnauthorizedException);
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
    expect(lan2.delivered_at.getTime()).toBe(lan1.delivered_at.getTime());
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

  // ── "Đang giao" phải đến từ GHN ──────────────────────────────────────────
  //
  // Người bán không tự đặt được "Đang giao" (policy SHIPPING chỉ cho ADMIN),
  // vì trạng thái đó phải là lời GHN: tài xế đã lấy hàng. Trước bản này webhook
  // và lượt quét chỉ nghe đúng một chữ `delivered`, nên với GHN thật không có
  // gì đưa đơn sang "Đang giao" cả. Lối duy nhất là nút giả lập, mà nút đó chỉ
  // chạy ở sandbox.
  async function datTrangThaiDon(status: string) {
    await ds.query('UPDATE orders SET status = ? WHERE id = ?', [
      status,
      orderId,
    ]);
  }
  async function trangThaiDon(): Promise<string> {
    const rows = await ds.query<Array<{ status: string }>>(
      'SELECT status FROM orders WHERE id = ?',
      [orderId],
    );
    return rows[0].status;
  }

  it('GHN báo tài xế đã lấy hàng → đơn đã xác nhận sang Đang giao', async () => {
    await datTrangThaiDon('confirmed');
    const lo = await taoLo();
    ghnTraVe = 'picked';

    const kq = await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });

    expect(await trangThaiDon()).toBe('shipping');
    // Lô vẫn CREATED: "đã lấy hàng" chưa phải "đã giao", không được mở cửa sổ
    // tự-xác-nhận giải ngân.
    expect((await doc(lo.id)).status).toBe(ShipmentStatus.CREATED);
    expect(kq.updated).toBe(true);
  });

  it('GHN mới chờ lấy hàng → đơn giữ nguyên Đã xác nhận', async () => {
    await datTrangThaiDon('confirmed');
    await taoLo();

    for (const st of ['ready_to_pick', 'picking']) {
      ghnTraVe = st;
      const kq = await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });
      expect(kq.updated).toBe(false);
    }
    expect(await trangThaiDon()).toBe('confirmed');
  });

  it('đơn đã huỷ thì GHN báo đã lấy hàng cũng KHÔNG kéo về Đang giao', async () => {
    await datTrangThaiDon('cancelled');
    await taoLo();
    ghnTraVe = 'picked';

    await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });

    expect(await trangThaiDon()).toBe('cancelled');
  });

  it('lỡ mất sự kiện lấy hàng, nghe thẳng delivered → đơn vẫn sang Đang giao', async () => {
    await datTrangThaiDon('confirmed');
    const lo = await taoLo();
    ghnTraVe = 'delivered';

    await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });

    expect(await trangThaiDon()).toBe('shipping');
    expect((await doc(lo.id)).status).toBe(ShipmentStatus.DELIVERED);
  });

  it('đồng bộ định kỳ cũng đưa đơn đang chuẩn bị sang Đang giao', async () => {
    await datTrangThaiDon('processing');
    const lo = await taoLo();
    ghnTraVe = 'transporting';

    await svc.dongBoTatCa();

    expect(await trangThaiDon()).toBe('shipping');
    expect((await doc(lo.id)).status).toBe(ShipmentStatus.CREATED);
  });

  // ── Ghi đè khi người mua xác nhận chen giữa ──────────────────────────────
  //
  // Lượt đồng bộ nạp lô, hỏi GHN (mạng, vài giây), rồi `save(lo)` NGUYÊN
  // entity đã nạp. Người mua bấm "Đã nhận hàng" trong quãng đó (lô sang
  // RECEIVED, ghi received_at, tiền đã nhả cho người bán) thì lần lưu này kéo
  // lô về DELIVERED và xoá received_at: job tự xác nhận sau N ngày thấy lô
  // "chưa nhận" và nhả tiền lần hai cho cùng một lô.
  async function nguoiMuaNhanGiuaChung(loId: number, luc: Date) {
    (svc as unknown as { ghn: Pick<GhnService, 'getOrderStatus'> }).ghn = {
      getOrderStatus: async () => {
        await ds.query(
          `UPDATE order_shipments
              SET status = 'received', received_at = ?, delivered_at = ?
            WHERE id = ?`,
          [luc, luc, loId],
        );
        return 'delivered';
      },
    };
  }

  it('lượt đồng bộ không ghi đè lô người mua vừa xác nhận', async () => {
    const lo = await taoLo();
    const luc = new Date('2026-10-20T10:00:00Z');
    await nguoiMuaNhanGiuaChung(lo.id, luc);

    const kq = await svc.dongBoTatCa();

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.RECEIVED);
    expect(sau.received_at?.getTime()).toBe(luc.getTime());
    expect(sau.delivered_at?.getTime()).toBe(luc.getTime());
    expect(kq.delivered).toBe(0);
  });

  it('webhook cũng không ghi đè lô người mua vừa xác nhận', async () => {
    const lo = await taoLo();
    const luc = new Date('2026-10-20T10:00:00Z');
    await nguoiMuaNhanGiuaChung(lo.id, luc);

    const kq = await svc.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });

    const sau = await doc(lo.id);
    expect(sau.status).toBe(ShipmentStatus.RECEIVED);
    expect(sau.received_at?.getTime()).toBe(luc.getTime());
    expect(kq.updated).toBe(false);
  });

  // ── Hoàn hàng, huỷ, thất lạc ─────────────────────────────────────────────
  //
  // Tới 27/10 lượt đồng bộ chỉ nghe "đã lấy hàng" và "đã giao". GHN báo hoàn
  // hàng, huỷ hay thất lạc thì không gì xảy ra: lô nằm CREATED, đơn nằm "Đang
  // giao" vĩnh viễn, tiền người mua kẹt trong ký quỹ, không ai được báo. Tối
  // thiểu phải: ghi lý do lên lô và báo quản trị viên. KHÔNG tự hoàn tiền: hàng
  // hoàn về tay người bán hay mất giữa đường là chuyện cần người xem.
  const SU_CO = [
    'return',
    'returning',
    'return_transporting',
    'return_sorting',
    'returned',
    'cancel',
    'lost',
    'damage',
    'exception',
  ];

  async function dungVoiKenh() {
    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ('ad', 'ad@t.local', 'x', 'admin')`,
    );
    const adminId = await idVuaChen();
    const gui: Array<{
      user_id: number;
      type: string;
      content: string;
      data?: Record<string, unknown>;
    }> = [];
    const kenh = {
      create: (d: (typeof gui)[number]) => {
        gui.push(d);
        return Promise.resolve(undefined);
      },
    };
    const s2 = new ShipmentTrackingService(repo, ghnGoc, kenh as never);
    return { s2, gui, adminId };
  }

  it.each(SU_CO)(
    'GHN báo "%s" → ghi lý do lên lô, báo admin một lần, không động tiền',
    async (st) => {
      const { s2, gui, adminId } = await dungVoiKenh();
      const lo = await taoLo();
      ghnTraVe = st;

      await s2.dongBoTatCa();

      const sau = await doc(lo.id);
      // Không tự chốt giao, không tự huỷ: tiền đi đâu là việc của người.
      expect(sau.status).toBe(ShipmentStatus.CREATED);
      expect(sau.delivered_at).toBeNull();
      expect(sau.error ?? '').toContain(st);

      const choAdmin = gui.filter((g) => g.user_id === adminId);
      expect(choAdmin).toHaveLength(1);
      expect(choAdmin[0].type).toBe('system');
      expect(choAdmin[0].data).toMatchObject({ order_id: orderId });

      // Lượt quét giờ sau gặp lại đúng trạng thái đó thì không báo lại.
      await s2.dongBoTatCa();
      expect(gui.filter((g) => g.user_id === adminId)).toHaveLength(1);
    },
  );

  it('webhook nghe GHN báo hoàn hàng cũng ghi lý do và báo admin', async () => {
    const { s2, gui, adminId } = await dungVoiKenh();
    const lo = await taoLo();
    ghnTraVe = 'returned';

    await s2.xuLyWebhook(TOKEN, { OrderCode: 'GHN123' });

    expect((await doc(lo.id)).error ?? '').toContain('returned');
    expect(gui.filter((g) => g.user_id === adminId)).toHaveLength(1);
  });

  it('một lô lỗi không làm chết cả lượt đồng bộ', async () => {
    await taoLo(ShipmentStatus.CREATED, 'GHN-HONG');
    await taoLo(ShipmentStatus.CREATED, 'GHN-OK');

    let lan = 0;
    // Thay GhnService bằng bản hỏng ở lần gọi đầu. Ép kiểu qua `unknown` chứ
    // không `any`: vẫn vào được field private mà không tắt kiểm tra cả đối tượng.
    (svc as unknown as { ghn: Pick<GhnService, 'getOrderStatus'> }).ghn = {
      getOrderStatus: () => {
        lan += 1;
        if (lan === 1) return Promise.reject(new Error('GHN 500'));
        return Promise.resolve('delivered');
      },
    };

    const kq = await svc.dongBoTatCa();
    expect(kq.checked).toBe(2);
    expect(kq.delivered).toBe(1);
  });
});
