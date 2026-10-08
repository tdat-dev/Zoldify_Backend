import { DataSource } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Follow } from '@catalog/follows/entities/follow.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { OrderShipment } from '@ordering/orders/entities/order-shipment.entity';
import { Escrow } from '@money/escrows/entities/escrow.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { LedgerAccount } from '@money/ledger/entities/ledger-account.entity';
import { LedgerTransaction } from '@money/ledger/entities/ledger-transaction.entity';
import { LedgerEntry } from '@money/ledger/entities/ledger-entry.entity';
import { RecommendationsService } from './recommendations.service';

/**
 * GỢI Ý SẢN PHẨM (task #15) — viết TEST TRƯỚC.
 *
 * Ô task ghi rõ: *"SQL trên bảng `interactions` đã có, KHÔNG CẦN ML"*. Nên đây
 * là hai câu SQL, và thứ đáng kiểm là **câu SQL trả về đúng cái gì** — mock
 * repository đi thì không còn gì để kiểm. Chạy trên MySQL thật.
 *
 * ĐÃ ĐO TRƯỚC KHI VIẾT, không đoán. `EXPLAIN` cả hai câu trên
 * `zoldify_sqlaudit` (1000 sản phẩm, 2012 dòng order_items):
 *
 *   co-purchase : oi1 ref idx_product_id · oi2 ref FK(order_id) · p eq_ref PRIMARY
 *   gợi ý riêng : thêm hai subquery MATERIALIZED, cả hai "Using index"
 *
 * Không bảng thật nào bị quét toàn phần, nên **không cần index mới**. Dự đoán
 * ban đầu của tôi là cần `order_items(product_id, order_id)` — sai; index
 * `idx_product_id` sẵn có cộng với index khoá ngoại trên `order_id` đã phủ đủ
 * cả hai chiều.
 *
 * Ba luật bắt buộc, học từ lỗi đã có trong repo:
 *   · chỉ `ACTIVE` — đúng lỗi `2752f41` đã phải vá ở danh sách công khai
 *   · chỉ `stock > 0` — gợi ý hàng hết là dẫn người mua vào ngõ cụt
 *   · chặn trần `limit` — Epic 3 chặn limit toàn hệ
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('RecommendationsService — gợi ý bằng SQL, không ML', () => {
  let ds: DataSource;
  let service: RecommendationsService;

  /** Mỗi lần chạy một dải id riêng — bài học từ `wallets.service.spec.ts`. */
  const R = Math.floor(Math.random() * 100_000);
  const ID = {
    nguoiBan: 7_000_000 + R,
    muaA: 7_100_000 + R,
    muaB: 7_200_000 + R,
    muaMoi: 7_300_000 + R,
    danhMuc: 7_400_000 + R,
  };

  /** id sản phẩm dùng trong các ca, đặt tên theo vai trò để đọc được. */
  const SP = {
    goc: 0,
    kemNhieu: 0,
    kemIt: 0,
    cungDanhMuc: 0,
    biTuChoi: 0,
    hetHang: 0,
  };

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
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    service = new RecommendationsService(ds);
    await dungDuLieu();
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  /**
   * Dựng một kịch bản mua hàng có thật:
   *
   *   đơn 1 (muaA): gốc + kèmNhiều + biTuChối
   *   đơn 2 (muaB): gốc + kèmNhiều
   *   đơn 3 (muaB): gốc + kèmÍt + hếtHàng
   *
   * → kèmNhiều xuất hiện cùng gốc 2 lần, kèmÍt 1 lần. biTuChối và hếtHàng phải
   *   bị loại dù cùng đơn.
   */
  async function dungDuLieu() {
    const u = ds.getRepository(User);
    const c = ds.getRepository(Category);
    const p = ds.getRepository(Product);
    const o = ds.getRepository(Order);
    const oi = ds.getRepository(OrderItem);

    await u.save([
      {
        id: ID.nguoiBan,
        full_name: 'Ban',
        email: `b${R}@t.local`,
        password: 'x',
      },
      { id: ID.muaA, full_name: 'A', email: `a${R}@t.local`, password: 'x' },
      { id: ID.muaB, full_name: 'B', email: `c${R}@t.local`, password: 'x' },
      {
        id: ID.muaMoi,
        full_name: 'Moi',
        email: `m${R}@t.local`,
        password: 'x',
      },
    ] as never);

    await c.save({ id: ID.danhMuc, name: `DM ${R}`, slug: `dm-${R}` } as never);

    const taoSP = async (ten: string, status: ProductStatus, stock: number) => {
      const saved = await p.save({
        name: ten,
        slug: `${ten}-${R}`.toLowerCase().replace(/\s/g, '-'),
        price: 100000,
        stock,
        status,
        category: { id: ID.danhMuc },
        seller: { id: ID.nguoiBan },
      } as never);
      return (saved as unknown as Product).id;
    };

    SP.goc = await taoSP('goc', ProductStatus.ACTIVE, 10);
    SP.kemNhieu = await taoSP('kem nhieu', ProductStatus.ACTIVE, 10);
    SP.kemIt = await taoSP('kem it', ProductStatus.ACTIVE, 10);
    SP.cungDanhMuc = await taoSP('cung danh muc', ProductStatus.ACTIVE, 10);
    SP.biTuChoi = await taoSP('bi tu choi', ProductStatus.REJECTED, 10);
    SP.hetHang = await taoSP('het hang', ProductStatus.ACTIVE, 0);

    const taoDon = async (userId: number, productIds: number[]) => {
      // `receiver_name`, `receiver_phone`, `shipping_address` là NOT NULL không
      // mặc định trong `order.entity.ts`. Thiếu chúng thì MySQL từ chối với
      // "Field 'receiver_name' doesn't have a default value" — lỗi của FIXTURE,
      // không phải của câu SQL đang kiểm, nhưng nó làm cả 8 ca đỏ giống hệt
      // nhau nên rất dễ đổ oan cho service.
      const don = (await o.save({
        user: { id: userId },
        order_code: `REC${R}${Math.floor(Math.random() * 1e6)}`,
        total_amount: 1,
        final_amount: 1,
        receiver_name: 'Nguoi nhan',
        receiver_phone: '0900000000',
        shipping_address: 'So 1, duong Test',
      } as never)) as unknown as Order;
      for (const pid of productIds) {
        await oi.save({
          order: { id: don.id },
          product: { id: pid },
          product_name: 'x',
          price: 1,
          quantity: 1,
          subtotal: 1,
        } as never);
      }
    };

    await taoDon(ID.muaA, [SP.goc, SP.kemNhieu, SP.biTuChoi]);
    await taoDon(ID.muaB, [SP.goc, SP.kemNhieu]);
    await taoDon(ID.muaB, [SP.goc, SP.kemIt, SP.hetHang]);
  }

  const ids = (rows: Array<{ id: number }>) => rows.map((r) => r.id);

  // ── /products/:id/related ────────────────────────────────────────────────
  it('1. xếp theo số lần MUA CÙNG: kèm nhiều đứng trước kèm ít', async () => {
    const rows = await service.relatedToProduct(SP.goc, 10);
    const vt = ids(rows);
    expect(vt.indexOf(SP.kemNhieu)).toBeGreaterThanOrEqual(0);
    expect(vt.indexOf(SP.kemIt)).toBeGreaterThanOrEqual(0);
    expect(vt.indexOf(SP.kemNhieu)).toBeLessThan(vt.indexOf(SP.kemIt));
  });

  it('2. KHÔNG trả về chính sản phẩm đang xem', async () => {
    const rows = await service.relatedToProduct(SP.goc, 10);
    expect(ids(rows)).not.toContain(SP.goc);
  });

  it('3. KHÔNG trả hàng bị từ chối, dù nó nằm cùng đơn', async () => {
    // Đúng lỗi `2752f41` đã phải vá ở danh sách sản phẩm công khai: thiếu lọc
    // `status` thì tin vừa bị quản trị viên từ chối lại được bày ra.
    const rows = await service.relatedToProduct(SP.goc, 10);
    expect(ids(rows)).not.toContain(SP.biTuChoi);
  });

  it('4. KHÔNG trả hàng đã hết kho', async () => {
    // Gợi ý một món không mua được là dẫn người mua vào ngõ cụt.
    const rows = await service.relatedToProduct(SP.goc, 10);
    expect(ids(rows)).not.toContain(SP.hetHang);
  });

  it('5. sản phẩm chưa ai mua cùng vẫn có gợi ý — đỡ bằng cùng danh mục', async () => {
    // Hàng mới đăng chưa có đơn nào. Trang chi tiết của nó mà trống trơn thì
    // trông như hỏng, nên phải có tầng đỡ.
    const rows = await service.relatedToProduct(SP.cungDanhMuc, 10);
    expect(rows.length).toBeGreaterThan(0);
    expect(ids(rows)).not.toContain(SP.cungDanhMuc);
  });

  // ── /recommendations/me ──────────────────────────────────────────────────
  it('6. gợi ý riêng LOẠI những món người đó đã mua', async () => {
    // muaB đã mua goc, kemNhieu, kemIt, hetHang. Gợi ý lại thứ vừa mua là
    // quảng cáo ngược.
    const rows = await service.forUser(ID.muaB, 10);
    const vt = ids(rows);
    expect(vt).not.toContain(SP.goc);
    expect(vt).not.toContain(SP.kemNhieu);
    expect(vt).not.toContain(SP.kemIt);
  });

  it('7. tài khoản MỚI TINH vẫn nhận được danh sách', async () => {
    // Không có lịch sử gì để dựa vào. Trang chủ rỗng ngay sau khi đăng ký là
    // ấn tượng đầu tiên tệ nhất có thể.
    const rows = await service.forUser(ID.muaMoi, 10);
    expect(rows.length).toBeGreaterThan(0);
  });

  // ── Trần limit ───────────────────────────────────────────────────────────
  it('8. limit khổng lồ bị chặn trần', async () => {
    // Cùng lý do với Epic 3 (chặn limit toàn hệ): một `?limit=1000000` dựng cả
    // triệu entity trong RAM của một tiến trình Node đơn luồng.
    const rows = await service.relatedToProduct(SP.goc, 1_000_000);
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});
