import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { tuyChonTruyVanCham } from './log-truy-van-cham';

/**
 * Câu SQL chậm phải hiện trong log, và KHÔNG kèm tham số.
 *
 * Đợt rà 1 triệu dòng (28/10): API trượt dần thành timeout, nhưng log không
 * có dòng nào nói câu SQL nào chậm. TypeORM chỉ báo câu chậm khi có
 * `maxQueryExecutionTime`; cả AppModule lẫn WorkerModule đều chưa đặt.
 *
 * Logger mặc định của TypeORM thì in câu chậm KÈM THAM SỐ ra console: với một
 * câu UPDATE users đó là email, hash mật khẩu, refresh token. Log JSON của repo
 * đã phải che token trong URL (log-an-bi-mat-url); không được mở lại cửa đó ở
 * đây. Nên dùng logger riêng, đi qua Nest Logger (tức qua JsonLogger).
 */
describe('tuyChonTruyVanCham', () => {
  const cu = process.env.DB_SLOW_QUERY_MS;
  afterEach(() => {
    if (cu === undefined) delete process.env.DB_SLOW_QUERY_MS;
    else process.env.DB_SLOW_QUERY_MS = cu;
    jest.restoreAllMocks();
  });

  it('mặc định ngưỡng 1000ms', () => {
    delete process.env.DB_SLOW_QUERY_MS;
    expect(tuyChonTruyVanCham().maxQueryExecutionTime).toBe(1000);
  });

  it('đọc ngưỡng từ DB_SLOW_QUERY_MS; giá trị hỏng thì về mặc định', () => {
    process.env.DB_SLOW_QUERY_MS = '250';
    expect(tuyChonTruyVanCham().maxQueryExecutionTime).toBe(250);
    process.env.DB_SLOW_QUERY_MS = 'abc';
    expect(tuyChonTruyVanCham().maxQueryExecutionTime).toBe(1000);
  });

  it('ghi cảnh báo có thời gian và câu SQL, KHÔNG có tham số', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { logger } = tuyChonTruyVanCham();
    logger.logQuerySlow(
      1234,
      'UPDATE `users`\n   SET `refresh_token` = ?   WHERE `id` = ?',
      ['bi-mat-khong-duoc-in', 7],
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const dong = String(warn.mock.calls[0][0]);
    expect(dong).toContain('1234ms');
    expect(dong).toContain(
      'UPDATE `users` SET `refresh_token` = ? WHERE `id` = ?',
    );
    expect(dong).not.toContain('bi-mat-khong-duoc-in');
  });

  it('cắt câu SQL quá dài (IN với hàng nghìn id) để một dòng log không thành vài trăm KB', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { logger } = tuyChonTruyVanCham();
    logger.logQuerySlow(
      2000,
      'SELECT 1 FROM t WHERE id IN (' + '1,'.repeat(5000) + '1)',
    );
    expect(String(warn.mock.calls[0][0]).length).toBeLessThan(700);
  });
});

const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

describe('DataSource thật với tuyChonTruyVanCham', () => {
  it('câu chạy quá ngưỡng thì có một dòng cảnh báo', async () => {
    process.env.DB_SLOW_QUERY_MS = '100';
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [],
      ...tuyChonTruyVanCham(),
    });
    try {
      await ds.initialize();
      await ds.query('SELECT SLEEP(0.01)');
      expect(warn).not.toHaveBeenCalled();
      await ds.query('SELECT SLEEP(0.3)');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('SELECT SLEEP(0.3)');
    } finally {
      delete process.env.DB_SLOW_QUERY_MS;
      warn.mockRestore();
      if (ds.isInitialized) await ds.destroy();
    }
  });
});
