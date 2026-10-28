import { DataSource } from 'typeorm';
import { MysqlQueryRunner } from 'typeorm/driver/mysql/MysqlQueryRunner';
import { ChatService } from './chat.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';

/**
 * Tab Chat với hội thoại DÀI (rà soát "1 triệu dòng" 28/10): bài kiểm viết TRƯỚC.
 *
 * `tinNhanCuoiTheoLo` dùng `ROW_NUMBER() OVER (PARTITION BY conversation_id)`
 * trên MỌI tin của tối đa 20 hội thoại, kéo TẤT CẢ các dòng (kèm `content`
 * kiểu TEXT) về Node rồi mới bỏ hết, chỉ giữ hạng 1. `chat.service.spec.ts`
 * không thấy vì mỗi hội thoại ở đó chỉ có 3 tin. Hai người nhắn với nhau một
 * năm là vài nghìn tin; 20 hội thoại như thế là vài chục nghìn dòng TEXT đi
 * qua heap 384MB của một bản api, cho MỘT lần mở tab Chat.
 *
 * Pre-mortem:
 *
 * | Rủi ro                                             | Chặn bằng                                   |
 * |----------------------------------------------------|---------------------------------------------|
 * | Sửa xong lấy SAI tin cuối (MAX(id) thay vì mới nhất theo created_at) | bài "tin chèn sau mà giờ sớm hơn" |
 * | Hai tin cùng mốc giờ: kết quả đổi giữa các lần chạy | bài "cùng mốc giờ thì id lớn hơn thắng"    |
 * | Vẫn kéo cả hội thoại về Node, chỉ lọc khéo hơn    | đếm số dòng MỖI câu trả về (spy QueryRunner)|
 * | Hội thoại chưa có tin thì mất khỏi danh sách       | hội thoại rỗng vẫn có mặt, last_message null|
 * | Đếm chưa đọc thành COUNT(DISTINCT) (bảng tạm băm id) | soi câu SQL của getUnreadCount           |
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

/** Hội thoại dài: đủ để thấy khác biệt "1 dòng" và "cả hội thoại". */
const SO_TIN = 2000;

describe('ChatService: tin cuối của hội thoại dài', () => {
  let ds: DataSource;
  let svc: ChatService;
  let user: IUser;
  let convDai: number;
  let convNgan: number;
  let convRong: number;

  /** Số dòng mỗi câu SELECT trả về, ghi lại trong lúc spy bật. */
  let soDong: number[] = [];
  /** Câu SQL đã gửi, để soi hình dạng truy vấn. */
  let cauSql: string[] = [];
  let spy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Conversation, Message, Product, Category, User],
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
    svc = new ChatService(
      ds.getRepository(Conversation),
      ds.getRepository(Message),
      ds.getRepository(Product),
    );
    await dungDuLieu();
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (ds?.isInitialized) await ds.destroy();
  });

  /**
   * Đếm dòng ở tầng QueryRunner chứ không ở `getRawMany`: cách sửa nào (query
   * builder, `ds.query`, LATERAL, bảng dẫn xuất) cũng đi qua đây, nên bài kiểm
   * không trói vào một cách viết.
   */
  function batSpy() {
    soDong = [];
    cauSql = [];
    // Reflect.get: giữ hàm gốc để gọi lại với `this` của từng QueryRunner.
    const goc = Reflect.get(MysqlQueryRunner.prototype, 'query') as (
      this: MysqlQueryRunner,
      ...a: Parameters<MysqlQueryRunner['query']>
    ) => Promise<unknown>;
    spy = jest
      .spyOn(MysqlQueryRunner.prototype, 'query')
      .mockImplementation(async function (
        this: MysqlQueryRunner,
        ...args: Parameters<MysqlQueryRunner['query']>
      ) {
        cauSql.push(String(args[0]));
        const kq: unknown = await goc.apply(this, args);
        const rows = Array.isArray(kq)
          ? kq
          : Array.isArray((kq as { records?: unknown[] })?.records)
            ? (kq as { records: unknown[] }).records
            : null;
        if (rows) soDong.push(rows.length);
        return kq as never;
      });
  }

  function tatSpy() {
    spy?.mockRestore();
    spy = undefined;
  }

  async function lastId(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  async function dungDuLieu() {
    await ds.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['messages', 'conversations', 'users']) {
      await ds.query(`DELETE FROM ${t}`);
    }
    await ds.query('SET FOREIGN_KEY_CHECKS = 1');

    await ds.query(
      `INSERT INTO users (full_name, email, password, role)
       VALUES ('nguoi mua','b@t.local','x','buyer')`,
    );
    const buyerId = await lastId();
    user = { id: buyerId, role: 'buyer' } as IUser;

    const taoHoiThoai = async (i: number) => {
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
      return { convId: await lastId(), sellerId };
    };

    // Hội thoại dài: SO_TIN tin của người bán, giây thứ k. Tin chẵn đã đọc,
    // tin lẻ chưa đọc, nên chưa đọc = SO_TIN / 2.
    const dai = await taoHoiThoai(1);
    convDai = dai.convId;
    const goc = '2026-01-01 00:00:00';
    for (let tu = 0; tu < SO_TIN; tu += 500) {
      const vals: string[] = [];
      const params: unknown[] = [];
      for (let k = tu; k < Math.min(tu + 500, SO_TIN); k++) {
        vals.push('(?, ?, ?, ?, DATE_ADD(?, INTERVAL ? SECOND))');
        // Hai tin cuối CÙNG một mốc giờ: id lớn hơn phải thắng (thứ tự cũ
        // `created_at DESC, id DESC`).
        const giay = k === SO_TIN - 1 ? SO_TIN - 2 : k;
        params.push(convDai, dai.sellerId, `dai ${k}`, k % 2 === 0, goc, giay);
      }
      await ds.query(
        `INSERT INTO messages (conversation_id, sender_id, content, is_read, created_at)
         VALUES ${vals.join(',')}`,
        params,
      );
    }
    // Chèn SAU CÙNG (id lớn nhất) nhưng giờ SỚM nhất: cách sửa nào lấy MAX(id)
    // thay vì "mới nhất theo created_at" sẽ chọn nhầm tin này.
    await ds.query(
      `INSERT INTO messages (conversation_id, sender_id, content, is_read, created_at)
       VALUES (?, ?, 'chen muon gio som', 1, ?)`,
      [convDai, dai.sellerId, '2025-01-01 00:00:00'],
    );

    const ngan = await taoHoiThoai(2);
    convNgan = ngan.convId;
    for (let k = 0; k < 3; k++) {
      await ds.query(
        `INSERT INTO messages (conversation_id, sender_id, content, is_read, created_at)
         VALUES (?, ?, ?, ?, DATE_ADD(?, INTERVAL ? SECOND))`,
        [convNgan, ngan.sellerId, `ngan ${k}`, k < 2, goc, k],
      );
    }

    convRong = (await taoHoiThoai(3)).convId;
  }

  it('mỗi hội thoại đúng tin cuối, kể cả hội thoại dài và hội thoại rỗng', async () => {
    const { result } = await svc.getMyConversations(user, '1', '20');
    const theoId = new Map(result.map((c) => [c.id, c]));

    expect(result).toHaveLength(3);
    expect(theoId.get(convDai)?.last_message?.content).toBe(
      `dai ${SO_TIN - 1}`,
    );
    expect(theoId.get(convDai)?.unread_count).toBe(SO_TIN / 2);
    expect(theoId.get(convNgan)?.last_message?.content).toBe('ngan 2');
    expect(theoId.get(convNgan)?.unread_count).toBe(1);
    expect(theoId.get(convRong)?.last_message).toBeNull();
    expect(theoId.get(convRong)?.unread_count).toBe(0);
  });

  it(`không câu nào kéo cả hội thoại ${SO_TIN} tin về Node`, async () => {
    batSpy();
    try {
      await svc.getMyConversations(user, '1', '20');
    } finally {
      tatSpy();
    }
    // Trang có 3 hội thoại: mọi câu (trang hội thoại, đếm tổng, tin cuối,
    // đếm chưa đọc) đều trả tối đa 3 dòng. Bản ROW_NUMBER trả SO_TIN + 4.
    expect(Math.max(...soDong)).toBeLessThanOrEqual(3);
  });

  it('getUnreadCount là COUNT(*) thuần, không COUNT(DISTINCT)', async () => {
    batSpy();
    let kq: { unread_count: number };
    try {
      kq = await svc.getUnreadCount(user);
    } finally {
      tatSpy();
    }
    expect(kq.unread_count).toBe(SO_TIN / 2 + 1);
    // `getCount()` của TypeORM sinh COUNT(DISTINCT m.id): MySQL phải dựng
    // bảng tạm băm mọi id chưa đọc chỉ để khử trùng lặp không thể có (join
    // sang conversations là n-1). Một câu, một dòng, không DISTINCT.
    expect(cauSql).toHaveLength(1);
    expect(cauSql[0]).not.toMatch(/COUNT\s*\(\s*DISTINCT/i);
  });
});
