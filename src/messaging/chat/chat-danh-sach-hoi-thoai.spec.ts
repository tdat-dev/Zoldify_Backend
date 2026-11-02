import { DataSource, Logger as TypeOrmLogger } from 'typeorm';
import { ChatService } from './chat.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';

/**
 * Danh sách hội thoại (`GET /chat/conversations`) ở cỡ 1 triệu dòng: bài kiểm
 * viết TRƯỚC.
 *
 * Đo 02/11 trên zoldify_1mall (50.000 hội thoại, MySQL 8.4, buffer pool 512M,
 * `npm run loadtest` chế độ 1M): người bán nặng (5.000 hội thoại) p95 2.054 ms
 * khi chỉ MỘT người gọi, 8.975 ms dưới 50 kết nối; người mua nặng (2.000 hội
 * thoại) 846 ms một mình. performance_schema: hai câu chậm nhất của route là
 * `SELECT DISTINCTROW distinctAlias...` (1.172 ms trung bình, đọc 153.508 dòng,
 * KHÔNG dùng index) và `COUNT(DISTINCTROW Conversation.id)` (998 ms, 153.488
 * dòng). Nguyên nhân: `findAndCount({ where: [{ buyer }, { seller }],
 * relations, skip, take })` sinh `buyer_id = ? OR seller_id = ?` qua ba LEFT
 * JOIN; MySQL không gộp được hai index `idx_buyer_updated` /
 * `idx_seller_updated` cho câu có JOIN + ORDER BY, nên quét cả bảng hội thoại
 * cùng ba JOIN rồi mới sắp.
 *
 * Pre-mortem:
 *
 * | Rủi ro                                              | Chặn bằng                                 |
 * |-----------------------------------------------------|-------------------------------------------|
 * | Trộn hai phía sai thứ tự (mua/bán xen kẽ theo giờ)  | so trang 2 với câu SQL chuẩn               |
 * | Trùng giờ cập nhật: thứ tự đổi giữa các lần gọi     | chuẩn chốt `updated_at DESC, id DESC`     |
 * | meta.total đếm sai khi gộp hai phía                 | so với COUNT thật                          |
 * | Vẫn còn câu quét cả bảng hội thoại                  | EXPLAIN mọi câu chạm `conversations`       |
 * | Mất partner_name / unread_count khi đổi cách nạp    | kiểm khuôn của từng dòng                   |
 *
 * Chạy database riêng (bài này chèn hàng nghìn dòng):
 *   TEST_DB_NAME=zoldify_1mall_t npx jest chat-danh-sach-hoi-thoai
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(120_000);

class GhiSql implements TypeOrmLogger {
  cau: Array<{ q: string; p: unknown[] }> = [];
  logQuery(q: string, p?: unknown[]) {
    this.cau.push({ q, p: p ?? [] });
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

describe('ChatService.getMyConversations: hai phía đi hai index, không quét cả bảng', () => {
  let ds: DataSource;
  let svc: ChatService;
  const sql = new GhiSql();
  const R = Math.floor(Math.random() * 1e6);
  let u: IUser;
  const nguoiKhac: number[] = [];

  async function lastId(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Conversation, Message, Product, Category, User],
      synchronize: true,
      logger: sql,
    });
    await ds.initialize();
    svc = new ChatService(
      ds.getRepository(Conversation),
      ds.getRepository(Message),
      ds.getRepository(Product),
    );

    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('Người bán nặng', ?, 'x', ?)`,
      [`dsht-${R}-u@t.local`, UserRole.SELLER],
    );
    u = { id: await lastId(), role: UserRole.SELLER } as unknown as IUser;
    // 60 người khác: vừa là đối tác của u, vừa nhắn nhau để làm "nhiễu".
    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       WITH RECURSIVE s (n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM s WHERE n < 59)
       SELECT CONCAT('Đối tác ', n), CONCAT('dsht-${R}-', n, '@t.local'), 'x', 'buyer' FROM s`,
    );
    const rows = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM users WHERE email LIKE ? AND email <> ? ORDER BY id`,
      [`dsht-${R}-%`, `dsht-${R}-u@t.local`],
    );
    nguoiKhac.push(...rows.map((r) => Number(r.id)));

    // u là NGƯỜI BÁN trong 60 hội thoại, NGƯỜI MUA trong 60 hội thoại; giờ
    // cập nhật hai phía xen kẽ nhau, có cặp trùng giây để thử khoá phụ id.
    const giaTri: string[] = [];
    nguoiKhac.forEach((k, i) => {
      giaTri.push(`(${k}, ${u.id}, NOW() - INTERVAL ${i * 2} MINUTE)`);
      giaTri.push(
        `(${u.id}, ${k}, NOW() - INTERVAL ${i % 7 === 0 ? i * 2 : i * 2 + 1} MINUTE)`,
      );
    });
    await ds.query(
      `INSERT INTO conversations (buyer_id, seller_id, updated_at) VALUES ${giaTri.join(',')}`,
    );
    // Nhiễu: 3.540 hội thoại giữa những người khác (không có u).
    const nhieu: string[] = [];
    for (const a of nguoiKhac) {
      for (const b of nguoiKhac) {
        if (a !== b)
          nhieu.push(`(${a}, ${b}, NOW() - INTERVAL ${(a * b) % 900} MINUTE)`);
      }
    }
    await ds.query(
      `INSERT INTO conversations (buyer_id, seller_id, updated_at) VALUES ${nhieu.join(',')}`,
    );
    await ds.query('ANALYZE TABLE conversations');
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      const ids = [u.id, ...nguoiKhac].join(',');
      await ds.query(
        `DELETE FROM conversations WHERE buyer_id IN (${ids}) OR seller_id IN (${ids})`,
      );
      await ds.query(`DELETE FROM users WHERE id IN (${ids})`);
      await ds.destroy();
    }
  });

  type Dong = {
    id: number;
    partner_name?: string;
    partner_id?: number;
    unread_count: number;
    last_message: unknown;
  };

  it('trang 2 trộn đúng hai phía theo updated_at DESC, id DESC; meta.total đúng', async () => {
    const kq = (await svc.getMyConversations(u, '2', '20')) as {
      result: Dong[];
      meta: { total: number; pages: number };
    };
    const chuan = await ds.query<Array<{ id: number }>>(
      `SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?
        ORDER BY updated_at DESC, id DESC LIMIT 20 OFFSET 20`,
      [u.id, u.id],
    );
    expect(kq.result.map((r) => r.id)).toEqual(chuan.map((r) => Number(r.id)));
    expect(kq.meta.total).toBe(120);
    expect(kq.meta.pages).toBe(6);
    for (const r of kq.result) {
      expect(nguoiKhac).toContain(r.partner_id);
      expect(r.partner_name).toMatch(/^Đối tác /);
      expect(r.unread_count).toBe(0);
      expect(r.last_message).toBeNull();
    }
  });

  it('không câu nào có bảng con distinctAlias hay quét cả bảng hội thoại', async () => {
    sql.cau = [];
    await svc.getMyConversations(u, '1', '20');
    expect(sql.cau.filter((c) => /distinctAlias/.test(c.q))).toEqual([]);

    const cham = sql.cau.filter((c) => /\bFROM `conversations`/.test(c.q));
    expect(cham.length).toBeGreaterThan(0);
    for (const c of cham) {
      const plan = await ds.query<
        Array<{ table: string; type: string; key: string | null }>
      >(`EXPLAIN ${c.q}`, c.p);
      const quet = plan.filter(
        (d) => /conversation/i.test(d.table) && (d.type === 'ALL' || !d.key),
      );
      expect({ cau: c.q, quet }).toEqual({ cau: c.q, quet: [] });
    }
  });
});
