import { DataSource } from 'typeorm';
import { MarkSoldOutProducts1789500000000 } from '../../migrations/1789500000000-MarkSoldOutProducts';

/**
 * Migration đánh dấu ĐÃ BÁN cho tin cũ đã hết kho.
 *
 * `status-by-stock.ts` chỉ đổi trạng thái ở các lần ghi kho từ nay về sau. Tin
 * bán hết TRƯỚC bản sửa vẫn `active` với kho 0 (staging 12/11: i885, i1173 và
 * nhiều tin seed "HẾT HÀNG"), nên vẫn nằm đầu trang chủ. Migration chuyển đúng
 * nhóm đó sang `sold`, không đụng tin còn hàng, tin nháp hay bị ẩn vì khoá.
 *
 * Cập nhật theo lô nhỏ: trên prod bảng products có ~1 triệu dòng, một câu
 * UPDATE khổng lồ giữ khoá lâu trong lúc người dùng đang đặt hàng.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
};

jest.setTimeout(60_000);

describe('MarkSoldOutProducts: tin cũ hết kho thành đã bán', () => {
  const DB_NAME = `zoldify_mig_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  let root: DataSource;
  let ds: DataSource;

  beforeAll(async () => {
    root = new DataSource({ type: 'mysql', ...TEST_DB, database: 'mysql' });
    try {
      await root.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    await root.query(`CREATE DATABASE \`${DB_NAME}\``);
    ds = new DataSource({ type: 'mysql', ...TEST_DB, database: DB_NAME });
    await ds.initialize();
    await ds.query(
      `CREATE TABLE products (
         id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
         stock int NOT NULL,
         status enum('draft','pending','active','sold','rejected') NOT NULL
       )`,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (root?.isInitialized) {
      await root.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
      await root.destroy();
    }
  });

  it('chỉ tin active hết kho thành sold, nhiều hơn một lô vẫn hết sạch', async () => {
    const rows: Array<[number, string]> = [
      [0, 'active'], // hết hàng trước bản sửa: phải thành sold
      [3, 'active'], // còn hàng: giữ
      [0, 'draft'], // nháp hoặc bị ẩn vì khoá: giữ
      [0, 'rejected'],
      [5, 'sold'], // dữ liệu lạ: không tự mở bán lại ở migration này
    ];
    for (const [stock, status] of rows) {
      await ds.query('INSERT INTO products (stock, status) VALUES (?, ?)', [
        stock,
        status,
      ]);
    }
    // Đủ nhiều tin hết kho để migration phải chạy hơn một lô.
    for (let i = 0; i < 25; i++) {
      await ds.query(
        "INSERT INTO products (stock, status) VALUES (0, 'active')",
      );
    }

    const qr = ds.createQueryRunner();
    try {
      await new MarkSoldOutProducts1789500000000(10).up(qr);
    } finally {
      await qr.release();
    }

    const got = await ds.query<Array<{ id: number; status: string }>>(
      'SELECT id, status FROM products ORDER BY id',
    );
    expect(got.slice(0, 5).map((r) => r.status)).toEqual([
      'sold',
      'active',
      'draft',
      'rejected',
      'sold',
    ]);
    expect(got.slice(5).every((r) => r.status === 'sold')).toBe(true);
  });
});
