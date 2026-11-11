import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ganTatEm } from './tat-em';

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
      async () => {
        viec.push('dong');
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
    const res = {
      ma: 200,
      header: {} as Record<string, string>,
      body: undefined as unknown,
      status(m: number) {
        this.ma = m;
        return this;
      },
      setHeader(k: string, v: string) {
        this.header[k] = v;
      },
      send(b: unknown) {
        this.body = b;
      },
    };
    let quaTiep = false;
    tat.chanKhiTat({ method, path } as never, res as never, () => {
      quaTiep = true;
    });
    return { res, quaTiep };
  }

  it('chưa tắt: GET / đi tiếp như thường, không đổi header', () => {
    const { tat } = dung();
    const { res, quaTiep } = goi(tat, 'GET', '/');
    expect(quaTiep).toBe(true);
    expect(res.header).toEqual({});
  });

  it('nhận SIGTERM: GET / trả 503 để caddy rút bản này khỏi đội', () => {
    const { tienTrinh, tat } = dung();
    tienTrinh.emit('SIGTERM');
    const { res, quaTiep } = goi(tat, 'GET', '/');
    expect(quaTiep).toBe(false);
    expect(res.ma).toBe(503);
  });

  it('đang tắt: request thật vẫn được phục vụ, kèm Connection: close', () => {
    const { tienTrinh, tat } = dung();
    tienTrinh.emit('SIGTERM');
    const { res, quaTiep } = goi(tat, 'POST', '/api/v1/orders');
    expect(quaTiep).toBe(true);
    expect(res.header.Connection).toBe('close');
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
