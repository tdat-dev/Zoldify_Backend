import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHO_MS, ganTatEm } from './tat-em';

/**
 * BÀI KIỂM ĐỎ: deploy làm API trả 502 khoảng 5 giây (đo trên staging 11/11,
 * trang đích web nhận 404 giả trong lúc api khởi động lại).
 *
 * Node chạy là PID 1 trong container và api không bắt SIGTERM, nên `docker stop`
 * bị bỏ qua: Docker chờ 10 giây rồi SIGKILL, request đang chạy bị cắt ngang, và
 * caddy vẫn đẩy request vào bản đó tới lượt kiểm sức khoẻ sau. Khởi động lại
 * lần lượt từng bản chỉ hết 502 khi mỗi bản biết tự rút khỏi đội trước khi tắt.
 */
describe('ganTatEm', () => {
  function dung() {
    const tienTrinh = new EventEmitter();
    const viec: string[] = [];
    let moCho: () => void = () => undefined;
    const tat = ganTatEm(
      () => {
        viec.push('dong');
        return Promise.resolve();
      },
      {
        tienTrinh,
        logger: { log: () => undefined },
        cho: () => new Promise<void>((r) => (moCho = r)),
        thoat: (ma: number) => viec.push(`thoat ${ma}`),
      },
    );
    return { tienTrinh, viec, tat, xongCho: () => moCho() };
  }

  function goi(tat: ReturnType<typeof ganTatEm>, method: string, path: string) {
    const ketQua = { ma: 200, header: {} as Record<string, string> };
    const res = {
      status: (m: number) => {
        ketQua.ma = m;
        return res;
      },
      setHeader: (k: string, v: string) => {
        ketQua.header[k] = v;
      },
      send: () => undefined,
    };
    let quaTiep = false;
    tat.chanKhiTat({ method, path } as never, res as never, () => {
      quaTiep = true;
    });
    return { res: ketQua, quaTiep };
  }

  it('chưa tắt: GET / đi tiếp như thường, không đổi header', () => {
    const { tat } = dung();
    const { res, quaTiep } = goi(tat, 'GET', '/');
    expect(quaTiep).toBe(true);
    expect(res.header).toEqual({});
  });

  // Caddy KHÔNG chạy kiểm sức khoẻ chủ động với upstream `dynamic a` (tài liệu
  // reverse_proxy, và cụm thử 11/11 không có dòng log kiểm nào), nên trả 503 ở
  // `GET /` không rút được bản này ra. Thứ duy nhất làm được: mọi response kèm
  // `Connection: close` để caddy bỏ kết nối cũ tới bản này, rồi mới đóng cổng.
  it('đang tắt: mọi request, kể cả GET /, vẫn được phục vụ kèm Connection: close', () => {
    const { tienTrinh, tat } = dung();
    tienTrinh.emit('SIGTERM');
    for (const [method, path] of [
      ['GET', '/'],
      ['POST', '/api/v1/orders'],
    ]) {
      const { res, quaTiep } = goi(tat, method, path);
      expect(quaTiep).toBe(true);
      expect(res.ma).toBe(200);
      expect(res.header.Connection).toBe('close');
    }
  });

  it('chờ lâu hơn hạn giữ kết nối rảnh của caddy (keepalive 5s) rồi mới đóng', () => {
    const caddy = readFileSync(
      join(__dirname, '..', '..', 'Caddyfile'),
      'utf8',
    );
    const giu = /\bkeepalive\s+(\d+)s\b/.exec(caddy);
    expect(giu).not.toBeNull();
    expect(CHO_MS).toBeGreaterThan(Number(giu![1]) * 1000 * 1.5);
  });

  it('chờ caddy rút xong mới đóng app, rồi thoát mã 0', async () => {
    const { tienTrinh, viec, xongCho } = dung();
    tienTrinh.emit('SIGTERM');
    await new Promise((r) => setImmediate(r));
    expect(viec).toEqual([]);
    xongCho();
    await new Promise((r) => setImmediate(r));
    expect(viec).toEqual(['dong', 'thoat 0']);
  });

  it('SIGTERM lần hai không đóng app lần nữa', async () => {
    const { tienTrinh, viec, xongCho } = dung();
    tienTrinh.emit('SIGTERM');
    tienTrinh.emit('SIGTERM');
    xongCho();
    await new Promise((r) => setImmediate(r));
    expect(viec).toEqual(['dong', 'thoat 0']);
  });

  it('main.ts gắn tắt êm trước mọi middleware khác', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    const viTriTatEm = main.indexOf('app.use(tatEm.chanKhiTat)');
    expect(viTriTatEm).toBeGreaterThan(-1);
    expect(main.indexOf('app.use(')).toBe(viTriTatEm);
  });
});
