import type { Repository } from 'typeorm';
import { TasksService } from './tasks.service';
import type { Order } from '@ordering/orders/entities/order.entity';
import type { Product } from '@catalog/products/entities/product.entity';
import type { OrdersService } from '@ordering/orders/orders.service';

/**
 * `flushViewCount` làm mất lượt xem đến giữa lúc GET và lúc DEL.
 *
 * Bản cũ: SCAN khoá `view_count:*`, GET hết, cộng vào MySQL, rồi DEL hết.
 * Giữa GET và DEL là cả một vòng UPDATE MySQL (vài chục mili giây mỗi sản
 * phẩm), và mọi INCR rơi vào khoảng đó bị DEL xoá mất mà chưa từng được cộng.
 * Sản phẩm càng hot thì càng mất nhiều.
 *
 * Redis giả mô phỏng đúng một khách xem chen vào NGAY SAU mỗi lần đọc một
 * khoá. Đếm đúng nghĩa là: số cộng vào MySQL + số còn lại trong Redis = tổng
 * số lượt xem thật.
 */
describe('Flush view_count không mất lượt xem chen giữa', () => {
  function redisGia(banDau: Record<string, number>) {
    const kho = new Map<string, number>(Object.entries(banDau));
    let tongXem = Object.values(banDau).reduce((a, b) => a + b, 0);
    // Một khách mở trang đúng lúc job vừa đọc khoá này.
    const khachChen = (k: string) => {
      kho.set(k, (kho.get(k) ?? 0) + 1);
      tongXem += 1;
    };
    const lenh: Record<string, (k: string) => unknown> = {
      get: (k) => {
        const v = kho.get(k);
        khachChen(k);
        return v === undefined ? null : String(v);
      },
      getdel: (k) => {
        // Khoá sai kiểu (ai đó SET nhầm một hash) thì Redis trả lỗi riêng cho
        // đúng lệnh này trong pipeline, các lệnh khác vẫn chạy.
        if (k === 'view_count:hong') throw new Error('WRONGTYPE');
        const v = kho.get(k);
        kho.delete(k);
        khachChen(k);
        return v === undefined ? null : String(v);
      },
      del: (k) => (kho.delete(k) ? 1 : 0),
    };
    const pipeline = () => {
      const hang: Array<() => unknown> = [];
      const p: Record<string, unknown> = {
        exec: () =>
          Promise.resolve(
            hang.map((f) => {
              try {
                return [null, f()];
              } catch (e) {
                return [e, null];
              }
            }),
          ),
      };
      for (const ten of Object.keys(lenh)) {
        p[ten] = (k: string) => {
          hang.push(() => lenh[ten](k));
          return p;
        };
      }
      return p;
    };
    const redis = {
      scan: () => Promise.resolve(['0', [...kho.keys()]]),
      pipeline,
      ...Object.fromEntries(
        Object.entries(lenh).map(([ten, f]) => [
          ten,
          (k: string) => Promise.resolve(f(k)),
        ]),
      ),
    };
    return { redis, kho, tong: () => tongXem };
  }

  it('MySQL + Redis còn lại = tổng lượt xem thật', async () => {
    const daCong: Record<number, number> = {};
    const productRepo = {
      increment: (
        w: { id: number },
        _cot: string,
        n: number,
      ): Promise<unknown> => {
        daCong[w.id] = (daCong[w.id] ?? 0) + n;
        return Promise.resolve({});
      },
    } as unknown as Repository<Product>;

    const tasks = new TasksService(
      {} as Repository<Order>,
      productRepo,
      {} as OrdersService,
      {} as never,
    );
    // Có REDIS_URL thì constructor đã mở kết nối thật: đóng nó trước khi thay.
    (
      tasks as unknown as { redis?: { disconnect?: () => void } }
    ).redis?.disconnect?.();
    const { redis, kho, tong } = redisGia({
      'view_count:1': 5,
      'view_count:2': 3,
    });
    (tasks as unknown as { redis: unknown }).redis = redis;

    await tasks.flushViewCount();

    const trongMySql = Object.values(daCong).reduce((a, b) => a + b, 0);
    const conTrongRedis = [...kho.values()].reduce((a, b) => a + b, 0);
    expect(trongMySql).toBe(8);
    expect(trongMySql + conTrongRedis).toBe(tong());
  });

  // Review 27/10 (H): pipeline.exec trả lỗi THEO TỪNG LỆNH ([err, kết quả]).
  // Bản trước chỉ đọc kết quả, lỗi của một khoá bị bỏ qua không một dòng log:
  // lượt xem của khoá đó đứng yên mãi mà không ai biết vì sao.
  it('lệnh GETDEL lỗi trên một khoá thì ghi log, các khoá khác vẫn cộng', async () => {
    const daCong: Record<number, number> = {};
    const tasks = new TasksService(
      {} as Repository<Order>,
      {
        increment: (w: { id: number }, _c: string, n: number) => {
          daCong[w.id] = (daCong[w.id] ?? 0) + n;
          return Promise.resolve({});
        },
      } as unknown as Repository<Product>,
      {} as OrdersService,
      {} as never,
    );
    (
      tasks as unknown as { redis?: { disconnect?: () => void } }
    ).redis?.disconnect?.();
    const { redis } = redisGia({ 'view_count:1': 4, 'view_count:hong': 1 });
    (tasks as unknown as { redis: unknown }).redis = redis;
    const log = jest.spyOn(
      (tasks as unknown as { logger: { error: (m: string) => void } }).logger,
      'error',
    );

    await tasks.flushViewCount();

    expect(daCong).toEqual({ 1: 4 });
    const dong = log.mock.calls.map((c) => String(c[0]));
    expect(dong.some((d) => d.includes('view_count:hong'))).toBe(true);
  });
});
