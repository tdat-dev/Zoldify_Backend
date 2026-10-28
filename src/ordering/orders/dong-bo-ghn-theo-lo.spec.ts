import { DataSource, Repository } from 'typeorm';
import { MysqlQueryRunner } from 'typeorm/driver/mysql/MysqlQueryRunner';
import { ShipmentTrackingService } from './shipment-tracking.service';
import { OrderShipment } from './entities/order-shipment.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { User } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { GhnService } from '@ordering/ghn/ghn.service';

/**
 * Lượt đồng bộ GHN với NHIỀU lô (rà soát "1 triệu dòng" 28/10) — bài kiểm
 * viết TRƯỚC.
 *
 * `dongBoTatCa` nạp MỌI lô CREATED bằng `find()` không `take`, rồi hỏi GHN
 * TỪNG lô một, nối tiếp. GHN trả lời ~300ms, có khi tới timeout 10s: 5000 lô
 * đang đi là 25 phút nếu GHN khoẻ, nhiều giờ nếu GHN chậm. Trong lúc đó worker
 * (concurrency 1) không chạy được job nào khác: đơn quá hạn không ai huỷ, view
 * count không ai đổ về MySQL.
 *
 * Pre-mortem:
 *
 * | Rủi ro                                                  | Chặn bằng                          |
 * |---------------------------------------------------------|------------------------------------|
 * | Vẫn nạp cả bảng, chỉ chia nhỏ lúc xử lý                 | đếm dòng MỖI câu SELECT lô (<= 200) |
 * | Song song không giới hạn: 200 request GHN cùng lúc      | đếm số lời gọi GHN đang bay (<= 4)  |
 * | Có giới hạn lượt nhưng lượt sau làm lại từ đầu, lô cuối bảng không bao giờ tới lượt | các lượt nối nhau phủ đủ mọi lô, không lô nào hỏi hai lần |
 * | Hết giờ giữa lô: lô bị bỏ qua mất luôn                  | bài hạn giờ: mọi lô vẫn được hỏi qua các lượt |
 * | Một lô hỏng làm chết cả nhóm song song                  | `shipment-tracking.service.spec.ts` ("một lô lỗi") |
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

const SO_LO = 450;

/** Giới hạn mà bài kiểm muốn đặt lên lượt đồng bộ (xem `gioiHanDongBo`). */
interface GioiHan {
  kichLo: number;
  songSong: number;
  toiDaLo: number;
  toiDaMs: number;
}

describe('ShipmentTrackingService.dongBoTatCa với nhiều lô', () => {
  let ds: DataSource;
  let repo: Repository<OrderShipment>;

  /** Mã vận đơn đã hỏi GHN, theo thứ tự. */
  let daHoi: string[] = [];
  let dangBay = 0;
  let bayToiDa = 0;
  /** Độ trễ giả của GHN, ms. */
  let treGhn = 2;

  const ghnGia = {
    getOrderStatus: async (ma: string) => {
      daHoi.push(ma);
      dangBay += 1;
      bayToiDa = Math.max(bayToiDa, dangBay);
      await new Promise((r) => setTimeout(r, treGhn));
      dangBay -= 1;
      // "Đang giao": không đổi lô, nên mọi lượt đều phải hỏi lại đủ.
      return 'delivering';
    },
  } as unknown as GhnService;

  function dichVu(gioiHan?: Partial<GioiHan>): ShipmentTrackingService {
    const svc = new ShipmentTrackingService(repo, ghnGia);
    if (gioiHan) {
      const s = svc as unknown as { gioiHanDongBo: GioiHan };
      s.gioiHanDongBo = { ...s.gioiHanDongBo, ...gioiHan };
    }
    return svc;
  }

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

    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['order_shipments', 'order_items', 'orders', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('m','m@t.local','x','buyer')`,
    );
    const [mua] = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    await ds.query(
      `INSERT INTO orders (order_code, user_id, final_amount, status,
                           receiver_name, receiver_phone, shipping_address)
       VALUES ('ORD-NHIEU', ?, 100000, 'shipping', 'Nguoi Nhan', '0900000000', 'So 1')`,
      [mua.id],
    );
    const [don] = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );

    // Mỗi lô một người bán: uq_shipment_order_seller là UNIQUE(order, seller).
    const nguoiBan = Array.from(
      { length: SO_LO },
      (_, i) => `('s','s${i}@t.local','x','seller')`,
    );
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ${nguoiBan.join(',')}`,
    );
    await ds.query(
      `INSERT INTO order_shipments (order_id, seller_id, tracking_code, cod_amount, status)
       SELECT ?, u.id, CONCAT('GHN-', u.id), 0, 'created'
         FROM users u WHERE u.role = 'seller' ORDER BY u.id`,
      [don.id],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  beforeEach(() => {
    daHoi = [];
    dangBay = 0;
    bayToiDa = 0;
    treGhn = 2;
  });

  it('không câu SELECT lô nào trả quá 200 dòng, GHN tối đa 4 lời gọi cùng lúc', async () => {
    const soDong: number[] = [];
    const goc = MysqlQueryRunner.prototype.query;
    const spy = jest
      .spyOn(MysqlQueryRunner.prototype, 'query')
      .mockImplementation(async function (
        this: MysqlQueryRunner,
        ...args: Parameters<MysqlQueryRunner['query']>
      ) {
        const kq: unknown = await goc.apply(this, args);
        const sql = String(args[0]);
        if (/^\s*SELECT/i.test(sql) && /FROM `order_shipments`/i.test(sql)) {
          const rows = Array.isArray(kq)
            ? kq
            : ((kq as { records?: unknown[] })?.records ?? []);
          soDong.push(rows.length);
        }
        return kq as never;
      });

    let kq: { checked: number; delivered: number };
    try {
      kq = await dichVu().dongBoTatCa();
    } finally {
      spy.mockRestore();
    }

    expect(kq.checked).toBe(SO_LO);
    expect(new Set(daHoi).size).toBe(SO_LO);
    expect(soDong.length).toBeGreaterThan(0);
    expect(Math.max(...soDong)).toBeLessThanOrEqual(200);
    // Có song song thật (không thì 5000 lô x 300ms là 25 phút), nhưng chặn ở
    // 4 để không dội GHN và không chiếm hết 5 kết nối của worker.
    expect(bayToiDa).toBeLessThanOrEqual(4);
    expect(bayToiDa).toBeGreaterThan(1);
  });

  it('hạn số nhóm mỗi lượt: lượt sau đi tiếp chỗ lượt trước dừng, phủ đủ mọi lô', async () => {
    const svc = dichVu({ toiDaLo: 1 });

    const lan1 = await svc.dongBoTatCa();
    expect(lan1.checked).toBe(200);

    const lan2 = await svc.dongBoTatCa();
    const lan3 = await svc.dongBoTatCa();
    expect(lan2.checked + lan3.checked).toBe(SO_LO - 200);

    // Ba lượt phủ đủ 450 lô, không lô nào bị hỏi hai lần.
    expect(daHoi).toHaveLength(SO_LO);
    expect(new Set(daHoi).size).toBe(SO_LO);
  });

  it('hết hạn giờ giữa nhóm thì dừng sớm, lượt sau hỏi nốt phần còn lại', async () => {
    treGhn = 10;
    // 450 lô x 10ms / 4 luồng ~ 1.1 giây; hạn 200ms là dừng giữa chừng.
    const svc = dichVu({ toiDaMs: 200 });

    const batDau = Date.now();
    const lan1 = await svc.dongBoTatCa();
    expect(lan1.checked).toBeLessThan(SO_LO);
    // Dừng gần đúng hạn, không chạy hết nhóm 200 rồi mới dừng.
    expect(Date.now() - batDau).toBeLessThan(800);

    for (let i = 0; i < 20 && daHoi.length < SO_LO; i++) {
      await svc.dongBoTatCa();
    }
    // Lượt cuối có thể chạm đáy bảng rồi quay vòng hỏi lại từ đầu (vòng mới,
    // hợp lệ). Điều phải giữ: 450 lần hỏi ĐẦU TIÊN là 450 lô khác nhau, tức
    // không lô nào bị bỏ qua hay hỏi lặp trước khi cả bảng được phủ.
    expect(daHoi.length).toBeGreaterThanOrEqual(SO_LO);
    expect(new Set(daHoi.slice(0, SO_LO)).size).toBe(SO_LO);
  });
});
