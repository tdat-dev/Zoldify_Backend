import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { ChatService } from './chat.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';

/**
 * `getMyConversations` — bài kiểm viết TRƯỚC.
 *
 * VÌ SAO ENDPOINT NÀY LÀ CHỖ NẶNG NHẤT CÒN LẠI.
 *
 * Nó là tab Chat, người dùng bấm vào mỗi lần mở app. Và nó có ba lỗi chồng lên
 * nhau, đều thuộc loại mà Epic 1–3 đã chữa ở nơi khác nhưng bỏ sót ở đây:
 *
 *   1. KHÔNG phân trang. `find()` không `take` — nạp TOÀN BỘ hội thoại của
 *      user. Đúng con bệnh Epic 1 chữa cho `orders.findAll`.
 *   2. N+1 nhân đôi. Mỗi hội thoại thêm hai truy vấn: tin nhắn cuối, và đếm
 *      chưa đọc. 100 hội thoại = 201 truy vấn.
 *   3. `Promise.all` làm nó TỆ HƠN chứ không tốt hơn: 200 truy vấn bắn đồng
 *      thời vào pool 15 kết nối (task #5 vừa hạ từ 50 xuống 15). Trước đây pool
 *      rộng nên còn nuốt được; giờ thì nghẽn.
 *
 * PHÉP ĐO CỦA BÀI KIỂM NÀY LÀ ĐẾM SỐ TRUY VẤN, không phải đo thời gian.
 * Thời gian phụ thuộc máy, phụ thuộc cache, và trên database rỗng thì mọi thứ
 * đều nhanh — đúng cái bẫy `selfcheck-indexes.ts` đã ghi. Số truy vấn thì
 * không nói dối: N+1 nghĩa là số đó tăng theo số hội thoại, và một bản sửa
 * đúng nghĩa là nó ĐỨNG YÊN.
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

jest.setTimeout(90_000);

/** Logger chỉ làm một việc: đếm câu lệnh thật sự gửi xuống MySQL. */
class DemTruyVan implements TypeOrmLogger {
  public dem = 0;
  logQuery(q: string) {
    // Bỏ qua câu lệnh khung của TypeORM/transaction — chỉ đếm truy vấn dữ liệu.
    if (/^(START TRANSACTION|COMMIT|ROLLBACK|SET |SELECT VERSION)/i.test(q)) return;
    this.dem += 1;
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

describe('ChatService.getMyConversations', () => {
  let ds: DataSource;
  let svc: ChatService;
  const dem = new DemTruyVan();

  let buyerId: number;
  let user: IUser;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Conversation, Message, Product, Category, User],
      synchronize: true,
      logging: ['query'],
      logger: dem,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    svc = new ChatService(
      ds.getRepository(Conversation),
      ds.getRepository(Message),
      ds.getRepository(Product),
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  /** Dựng `soHoiThoai` hội thoại, mỗi cái vài tin nhắn. */
  async function dungDuLieu(soHoiThoai: number) {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['messages', 'conversations', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ('nguoi mua','b@t.local','x','buyer')`,
    );
    buyerId = await lastId();
    user = { id: buyerId, role: 'buyer' } as IUser;

    for (let i = 0; i < soHoiThoai; i++) {
      await ds.query(
        `INSERT INTO users (full_name, email, password, role)
         VALUES ('nguoi ban', ?, 'x', 'seller')`,
        [`s${i}@t.local`],
      );
      const sellerId = await lastId();
      await ds.query(
        `INSERT INTO conversations (buyer_id, seller_id) VALUES (?, ?)`,
        [buyerId, sellerId],
      );
      const convId = await lastId();

      // Ba tin của người bán, tin cuối là tin mới nhất và CHƯA đọc.
      for (let k = 0; k < 3; k++) {
        await ds.query(
          `INSERT INTO messages (conversation_id, sender_id, content, is_read, created_at)
           VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
          [convId, sellerId, `tin ${k} cua hoi thoai ${i}`, k < 2 ? 1 : 0, k],
        );
      }
    }
  }

  async function lastId(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  // ── Lỗi 1: không phân trang ──────────────────────────────────────────────
  it('có chặn số lượng — không nạp toàn bộ hội thoại', async () => {
    await dungDuLieu(12);
    const kq = await svc.getMyConversations(user, '1', '5');
    expect(kq).toHaveLength(5);
  });

  it('trang 2 nối tiếp trang 1, không trùng', async () => {
    await dungDuLieu(12);
    const t1 = await svc.getMyConversations(user, '1', '5');
    const t2 = await svc.getMyConversations(user, '2', '5');
    const id1 = t1.map((c) => c.id);
    const id2 = t2.map((c) => c.id);
    expect(id2).toHaveLength(5);
    expect(id1.filter((x) => id2.includes(x))).toHaveLength(0);
  });

  // ── Lỗi 2+3: N+1 ─────────────────────────────────────────────────────────
  //
  // Đây là mục quan trọng nhất. Số truy vấn phải ĐỨNG YÊN khi số hội thoại
  // tăng. Bản cũ: 1 + 2N. Bản đúng: hằng số.
  it('số truy vấn KHÔNG tăng theo số hội thoại', async () => {
    await dungDuLieu(3);
    dem.dem = 0;
    await svc.getMyConversations(user, '1', '50');
    const voi3 = dem.dem;

    await dungDuLieu(12);
    dem.dem = 0;
    await svc.getMyConversations(user, '1', '50');
    const voi12 = dem.dem;

    expect(voi12).toBe(voi3);
    // Và phải nhỏ: một câu lấy hội thoại + một câu tin cuối + một câu đếm.
    expect(voi12).toBeLessThanOrEqual(4);
  });

  // ── Nhanh mà sai thì tệ hơn chậm mà đúng ─────────────────────────────────
  it('vẫn trả đúng tin nhắn cuối và số tin chưa đọc', async () => {
    await dungDuLieu(4);
    const kq = await svc.getMyConversations(user, '1', '50');

    expect(kq).toHaveLength(4);
    for (const c of kq) {
      // Mỗi hội thoại có 3 tin, tin thứ 3 (k=2) là mới nhất và chưa đọc.
      expect(c.last_message?.content).toMatch(/^tin 2 cua hoi thoai/);
      expect(c.unread_count).toBe(1);
    }
  });

  it('hội thoại chưa có tin nhắn nào → last_message null, unread 0', async () => {
    await dungDuLieu(1);
    await ds.query('DELETE FROM messages');
    const kq = await svc.getMyConversations(user, '1', '50');
    expect(kq).toHaveLength(1);
    expect(kq[0].last_message).toBeNull();
    expect(kq[0].unread_count).toBe(0);
  });
});
