import { DataSource } from 'typeorm';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { PushToken } from './entities/push-token.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';

/**
 * Bảng `notifications` không bao giờ được dọn (rà soát "1 triệu dòng" 28/10,
 * mục 7).
 *
 * Mỗi đơn đổi trạng thái sinh vài thông báo, mỗi lần người bán đăng hàng
 * sinh một thông báo cho TỪNG người theo dõi. Không gì xoá chúng: bảng chỉ
 * phình, index `idx_user_created` phình theo, và bản dump backup mỗi đêm
 * cũng phình theo.
 *
 * Luật giữ lại: đã đọc thì giữ 90 ngày, chưa đọc thì giữ 180 ngày. Xoá theo
 * LÔ (DELETE ... LIMIT) để không khoá cả bảng trong một câu xoá trăm nghìn
 * dòng, và có trần mỗi lần chạy để một lần chạy không kéo dài vô hạn.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

type KetQuaDon = { da_xoa: number; so_lo: number; cham_tran: boolean };
type TuyChon = { lo?: number; tranMoiLan?: number; nghiMs?: number };
type CoDon = {
  donThongBaoCu?: (o?: TuyChon) => Promise<KetQuaDon>;
};

describe('Dọn thông báo cũ theo lô', () => {
  let ds: DataSource;
  let svc: NotificationsService;
  let userId: number;
  const R = Math.floor(Math.random() * 1e6);

  async function idVuaChen(): Promise<number> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT LAST_INSERT_ID() AS id',
    );
    return Number(rows[0].id);
  }

  async function them(ngayTruoc: number, daDoc: boolean): Promise<number> {
    await ds.query(
      `INSERT INTO notifications (user_id, type, title, content, is_read, created_at)
       VALUES (?, 'system', 't', 'c', ?, NOW() - INTERVAL ? DAY)`,
      [userId, daDoc ? 1 : 0, ngayTruoc],
    );
    return idVuaChen();
  }

  async function conLai(): Promise<number[]> {
    const rows = await ds.query<Array<{ id: number }>>(
      'SELECT id FROM notifications WHERE user_id = ? ORDER BY id',
      [userId],
    );
    return rows.map((r) => Number(r.id));
  }

  const don = (o?: TuyChon) => {
    const f = (svc as unknown as CoDon).donThongBaoCu;
    if (typeof f !== 'function') {
      throw new Error('NotificationsService chưa có donThongBaoCu');
    }
    return f.call(svc, o);
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, Notification, PushToken],
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
    await ds.query(
      `INSERT INTO users (full_name, email, password, role) VALUES ('tb', ?, 'x', ?)`,
      [`tb-cu-${R}@t.local`, UserRole.BUYER],
    );
    userId = await idVuaChen();
    svc = new NotificationsService(
      ds.getRepository(Notification),
      ds.getRepository(PushToken),
      {} as never,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
      await ds.query('DELETE FROM users WHERE id = ?', [userId]);
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    // Bảng dùng chung với spec khác: chỉ dọn thông báo cũ của chính bài này
    // trước, để số đếm "đã xoá" không lẫn dòng cũ của bài khác.
    await ds.query(
      `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL 80 DAY`,
    );
    await ds.query('DELETE FROM notifications WHERE user_id = ?', [userId]);
  });

  it('đã đọc > 90 ngày và mọi thứ > 180 ngày bị xoá; còn lại giữ nguyên', async () => {
    const docCu = await them(100, true); // xoá
    const chuaDoc100 = await them(100, false); // giữ: chưa đọc, < 180 ngày
    const chuaDoc200 = await them(200, false); // xoá
    const docMoi = await them(10, true); // giữ
    const docSat = await them(89, true); // giữ: chưa đủ 90 ngày

    const kq = await don({ lo: 1000 });
    expect(kq.da_xoa).toBe(2);
    expect(kq.cham_tran).toBe(false);
    const con = await conLai();
    expect(con).toEqual([chuaDoc100, docMoi, docSat].sort((a, b) => a - b));
    expect(con).not.toContain(docCu);
    expect(con).not.toContain(chuaDoc200);
  });

  it('xoá theo lô nhỏ cho tới hết', async () => {
    for (let i = 0; i < 5; i++) await them(120, true);
    const kq = await don({ lo: 2, nghiMs: 0 });
    expect(kq.da_xoa).toBe(5);
    expect(kq.so_lo).toBeGreaterThanOrEqual(3);
    expect(await conLai()).toEqual([]);
  });

  it('có trần mỗi lần chạy: dừng ở trần, lần sau xoá tiếp', async () => {
    for (let i = 0; i < 5; i++) await them(300, false);
    const lan1 = await don({ lo: 2, tranMoiLan: 3, nghiMs: 0 });
    expect(lan1.da_xoa).toBeLessThanOrEqual(3);
    expect(lan1.cham_tran).toBe(true);
    const lan2 = await don({ lo: 2, tranMoiLan: 100, nghiMs: 0 });
    expect(lan1.da_xoa + lan2.da_xoa).toBe(5);
    expect(await conLai()).toEqual([]);
  });
});
