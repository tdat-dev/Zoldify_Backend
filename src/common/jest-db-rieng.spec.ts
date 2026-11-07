import datDbRieng, { tenDbRieng } from '../../scripts/jest-db-rieng';

/**
 * Hai phiên jest ở hai worktree từng chạy cùng lúc trên một `zoldify_test`:
 * `beforeAll` của phiên này xoá bảng ngay giữa bài của phiên kia, nên bài đỏ
 * dù code không sai. Mỗi worktree phải có database riêng, còn CI đã khai
 * `TEST_DB_NAME` thì giữ nguyên.
 */
describe('Database riêng cho jest', () => {
  const cu = { ...process.env };

  afterEach(() => {
    process.env = { ...cu };
  });

  it('hai worktree ra hai tên, tên hợp lệ với MySQL', () => {
    const a = tenDbRieng('D:\\Zoldify\\wt-sessions');
    const b = tenDbRieng('D:\\Zoldify\\wt-sitemap');
    expect(a).toBe('zoldify_jest_wt_sessions');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9_]+$/);
  });

  it('tên quá dài vẫn nằm trong 64 ký tự của MySQL', () => {
    expect(tenDbRieng(`/x/${'a'.repeat(100)}`).length).toBeLessThanOrEqual(64);
  });

  it('đã khai TEST_DB_NAME thì giữ nguyên', async () => {
    process.env.TEST_DB_NAME = 'zoldify_test';
    process.env.TEST_DB_PORT = '1';
    await datDbRieng();
    expect(process.env.TEST_DB_NAME).toBe('zoldify_test');
  });

  it('không có MySQL thì không ném lỗi: bài không cần DB vẫn phải chạy được', async () => {
    delete process.env.TEST_DB_NAME;
    process.env.TEST_DB_HOST = '127.0.0.1';
    process.env.TEST_DB_PORT = '1';
    await expect(datDbRieng()).resolves.toBeUndefined();
    expect(process.env.TEST_DB_NAME).toMatch(/^zoldify_jest_/);
  });
});
