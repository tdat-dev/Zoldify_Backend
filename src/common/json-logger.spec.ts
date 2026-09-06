/**
 * Định dạng dòng log — bài kiểm giữ HỢP ĐỒNG giữa hai file.
 *
 * `scripts/log-summary.mjs` đọc chính những dòng này để tính p50/p95. Nó tìm
 * `msg === 'request'` và các trường `method`, `path`, `status`, `ms`. Đổi tên
 * một trường ở đây mà quên bên kia thì công cụ không báo lỗi — nó chỉ lặng lẽ
 * đếm ra 0 request, và người đọc tưởng máy chủ đang rảnh.
 *
 * Bài kiểm này khoá đúng chỗ đó lại.
 */
// Bài kiểm này phải NẠP LẠI module sau khi đặt biến môi trường (`dangMay`
// chốt lúc nạp), nên `require` động là cách duy nhất — `import` tĩnh bị nâng lên
// đầu file và chạy trước cả `process.env`. Và nó phải thay `process.stdout.write`
// để bắt được thứ module ghi ra. Hai việc đó vốn không an toàn kiểu, ở đây là có
// chủ đích và chỉ trong phạm vi file kiểm.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
describe('ghiDongLog — hợp đồng với scripts/log-summary.mjs', () => {
  const gom: string[] = [];
  let goc: typeof process.stdout.write;

  beforeEach(() => {
    jest.resetModules();
    gom.length = 0;
    goc = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => {
      gom.push(s);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = goc;
    delete process.env.LOG_JSON;
  });

  /** Nạp lại module sau khi đặt biến môi trường — `dangMay` chốt lúc nạp. */
  const nap = () => {
    process.env.LOG_JSON = '1';

    return require('./json-logger') as typeof import('./json-logger');
  };

  it('ở chế độ máy đọc: mỗi lần gọi ra ĐÚNG một dòng JSON hợp lệ', () => {
    const { ghiDongLog, xaNgay } = nap();
    ghiDongLog({
      level: 'info',
      msg: 'request',
      reqId: 'abc-1',
      method: 'GET',
      path: '/api/v1/products?currentPage=2',
      status: 200,
      ms: 12.34,
    });
    xaNgay();

    const dong = gom.join('').trimEnd().split('\n');
    expect(dong).toHaveLength(1);
    const o = JSON.parse(dong[0]) as Record<string, unknown>;
    // Đúng những trường mà log-summary.mjs đi tìm.
    expect(o.msg).toBe('request');
    expect(o.method).toBe('GET');
    expect(o.path).toBe('/api/v1/products?currentPage=2');
    expect(o.status).toBe(200);
    expect(o.ms).toBe(12.34);
    expect(o.reqId).toBe('abc-1');
    expect(typeof o.ts).toBe('string');
  });

  it('gom lô: nhiều lần gọi chỉ ghi ra MỘT lần', () => {
    // Đây là lý do phần gom lô tồn tại: mỗi lần ghi là một lời gọi hệ thống, và
    // đo được nó tốn 1,74 µs — đắt gấp ba mọi thứ khác trong middleware.
    const { ghiDongLog, xaNgay } = nap();
    for (let i = 0; i < 5; i++) {
      ghiDongLog({
        level: 'info',
        msg: 'request',
        method: 'GET',
        path: '/',
        status: 200,
        ms: 1,
      });
    }
    expect(gom).toHaveLength(0); // chưa ghi gì cả

    xaNgay();
    expect(gom).toHaveLength(1); // một lời gọi cho cả năm dòng
    expect(gom[0].trimEnd().split('\n')).toHaveLength(5);
  });

  it('mọi dòng đều tự đứng được — không dòng nào cụt', () => {
    const { ghiDongLog, xaNgay } = nap();
    ghiDongLog({ level: 'error', msg: 'hỏng rồi', ctx: 'OrdersService' });
    ghiDongLog({
      level: 'info',
      msg: 'request',
      method: 'POST',
      path: '/x',
      status: 500,
      ms: 3,
    });
    xaNgay();

    for (const d of gom.join('').trimEnd().split('\n')) {
      expect(() => JSON.parse(d)).not.toThrow();
    }
  });
});
