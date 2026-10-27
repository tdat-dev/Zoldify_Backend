import { DataSource } from 'typeorm';
import { AddOrderConfirmedAt1788400000000 } from '../../migrations/1788400000000-AddOrderConfirmedAt';

/**
 * Migration AddOrderConfirmedAt phải cho đơn ĐANG `confirmed` một mốc mới.
 *
 * Bản đầu chỉ thêm cột, để NULL cho mọi đơn cũ. Job huỷ quá hạn đọc
 * COALESCE(confirmed_at, paid_at, created_at), nên đơn COD người bán xác nhận
 * sáng nay mà đặt từ ba ngày trước (chưa có mã vận đơn vì GHN lỗi) bị huỷ ngay
 * lượt quét đầu tiên sau deploy: đúng con bệnh migration này sinh ra để chữa
 * (review 27/10, mục C).
 *
 * Chạy migration thật trên một database riêng dựng tạm, để không đụng bảng
 * `orders` mà các spec khác đang dùng.
 *
 * File nằm ở đây chứ KHÔNG trong `src/migrations/`: data-source nạp MỌI file
 * .ts trong thư mục đó làm migration, một spec nằm đó là `migration:run` vỡ.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
};

jest.setTimeout(60_000);

describe('AddOrderConfirmedAt: backfill đơn đang xác nhận', () => {
  const TEN_DB = `zoldify_mig_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  let goc: DataSource;
  let ds: DataSource;

  beforeAll(async () => {
    goc = new DataSource({ type: 'mysql', ...TEST_DB, database: 'mysql' });
    try {
      await goc.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db\nLỗi gốc: ${(err as Error).message}`,
      );
    }
    await goc.query(`CREATE DATABASE \`${TEN_DB}\``);
    ds = new DataSource({ type: 'mysql', ...TEST_DB, database: TEN_DB });
    await ds.initialize();
    // Chỉ những cột migration và job đụng tới.
    await ds.query(
      `CREATE TABLE orders (
         id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
         status varchar(20) NOT NULL,
         created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (goc?.isInitialized) {
      await goc.query(`DROP DATABASE IF EXISTS \`${TEN_DB}\``);
      await goc.destroy();
    }
  });

  it('đơn confirmed có mốc mới, đơn trạng thái khác giữ NULL', async () => {
    const baNgayTruoc = new Date(Date.now() - 72 * 3600 * 1000);
    for (const st of ['confirmed', 'pending', 'shipping', 'cancelled']) {
      await ds.query('INSERT INTO orders (status, created_at) VALUES (?, ?)', [
        st,
        baNgayTruoc,
      ]);
    }

    const qr = ds.createQueryRunner();
    try {
      await new AddOrderConfirmedAt1788400000000().up(qr);
    } finally {
      await qr.release();
    }

    const rows = await ds.query<
      Array<{ status: string; confirmed_at: Date | null }>
    >('SELECT status, confirmed_at FROM orders ORDER BY id');
    const theo = Object.fromEntries(
      rows.map((r) => [r.status, r.confirmed_at]),
    );

    expect(theo.confirmed).not.toBeNull();
    // Mốc là LÚC CHẠY migration: đủ một cửa sổ 48 giờ mới từ lúc deploy.
    expect(
      Date.now() - new Date(theo.confirmed as Date).getTime(),
    ).toBeLessThan(10 * 60 * 1000);
    expect(theo.pending).toBeNull();
    expect(theo.shipping).toBeNull();
    expect(theo.cancelled).toBeNull();
  });
});
