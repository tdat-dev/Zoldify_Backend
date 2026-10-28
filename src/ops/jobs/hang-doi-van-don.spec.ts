import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { JobsRunner } from './jobs.runner';
import {
  JOB_CHOT_VAN_DON,
  JOB_FLUSH_VIEW_COUNT,
  JOB_HUY_DON_QUA_HAN,
  LICH_LAP,
  TEN_HANG_DOI,
} from './jobs.constants';
import type { TasksService } from '@ops/tasks/tasks.service';
import type { ProductsService } from '@catalog/products/products.service';

/**
 * Lượt chốt vận đơn dài không được chặn huỷ đơn quá hạn và đổ view count
 * (rà soát "1 triệu dòng" 28/10) — bài kiểm viết TRƯỚC.
 *
 * Worker chạy MỘT hàng đợi với concurrency 1. Lượt chốt vận đơn (đồng bộ GHN
 * + tự xác nhận) có thể chạy hàng chục phút khi GHN chậm; trong lúc đó job huỷ
 * đơn quá hạn (giữ hàng, giữ tiền ký quỹ của người mua) và job đổ view count
 * 5 phút một lần xếp hàng phía sau, trễ theo đúng độ dài lượt GHN.
 *
 * Pre-mortem:
 *
 * | Rủi ro                                                  | Chặn bằng                            |
 * |---------------------------------------------------------|--------------------------------------|
 * | Tách hàng đợi nhưng huỷ đơn vẫn chờ chốt vận đơn        | bài này: chốt bị giữ, huỷ đơn vẫn xong |
 * | Lịch cũ "chot-van-don" còn trên hàng đợi chính, đẻ job hai nơi | donLichThua theo từng hàng đợi (selfcheck-worker) |
 * | Job chốt xếp vào hàng đợi cũ trước lúc deploy không ai nhận | bộ xử lý của cả hai worker nhận mọi tên job |
 * | Đổi tên job, lịch, removeOnComplete/removeOnFail         | jobs.schedule.spec.ts, selfcheck-worker |
 *
 * Cần Redis thật (TEST_REDIS_URL, CI có sẵn). Dựng `JobsRunner` THẬT với
 * TasksService giả, rồi xếp job vào đúng hàng đợi mà lịch của job đó dùng.
 */
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380';

jest.setTimeout(30_000);

/** Hàng đợi mà lịch lặp của job `ten` đăng ký vào. */
function hangDoiCua(ten: string): string {
  const l = LICH_LAP.find((x) => x.ten === ten) as
    | { hangDoi?: string }
    | undefined;
  return l?.hangDoi ?? TEN_HANG_DOI;
}

function choToi(dk: () => boolean, ms: number): Promise<boolean> {
  const het = Date.now() + ms;
  return new Promise((xong) => {
    const t = setInterval(() => {
      if (dk()) {
        clearInterval(t);
        xong(true);
      } else if (Date.now() > het) {
        clearInterval(t);
        xong(false);
      }
    }, 20);
  });
}

describe('Hàng đợi riêng cho chốt vận đơn', () => {
  let conn: IORedis;
  let runner: JobsRunner;
  const urlCu = process.env.REDIS_URL;

  let chotDangChay = false;
  let thaChot: () => void = () => undefined;
  let soHuy = 0;
  let soFlush = 0;

  beforeAll(async () => {
    conn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
    conn.on('error', () => undefined);
    await conn.ping();

    const tasks = {
      autoCancelOrders: () => {
        soHuy += 1;
        return Promise.resolve();
      },
      // Lượt chốt "dài": giữ tới khi bài kiểm thả.
      settleDeliveredShipments: () => {
        chotDangChay = true;
        return new Promise<void>((xong) => {
          thaChot = xong;
        });
      },
      flushViewCount: () => {
        soFlush += 1;
        return Promise.resolve();
      },
    } as unknown as TasksService;
    const products = {
      phatThongBaoHangMoi: () => Promise.resolve(),
    } as unknown as ProductsService;

    process.env.REDIS_URL = REDIS_URL;
    runner = new JobsRunner(tasks, products);
    await runner.onModuleInit();
  });

  afterAll(async () => {
    thaChot();
    await runner?.onApplicationShutdown();
    // Xoá đúng những lịch mình vừa ghi, KHÔNG obliterate: lỡ TEST_REDIS_URL
    // trỏ vào Redis thật thì obliterate là xoá job đang chờ (cùng lý do với
    // selfcheck-worker.ts).
    const ten = new Set([
      TEN_HANG_DOI,
      ...LICH_LAP.map((l) => hangDoiCua(l.ten)),
    ]);
    for (const q of ten) {
      const queue = new Queue(q, { connection: conn });
      for (const l of LICH_LAP) {
        await queue.removeJobScheduler(l.id).catch(() => undefined);
      }
      await queue.close();
    }
    conn?.disconnect();
    if (urlCu === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = urlCu;
  });

  async function xep(tenJob: string) {
    const q = new Queue(hangDoiCua(tenJob), { connection: conn });
    await q.add(tenJob, {}, { removeOnComplete: true, removeOnFail: true });
    await q.close();
  }

  it('chốt vận đơn đang chạy dài, huỷ đơn quá hạn và đổ view count vẫn chạy ngay', async () => {
    await xep(JOB_CHOT_VAN_DON);
    expect(await choToi(() => chotDangChay, 5_000)).toBe(true);

    const huyTruoc = soHuy;
    const flushTruoc = soFlush;
    await xep(JOB_HUY_DON_QUA_HAN);
    await xep(JOB_FLUSH_VIEW_COUNT);

    // Chốt vận đơn VẪN đang bị giữ. Chung hàng đợi concurrency 1 thì hai job
    // này nằm chờ tới khi nó xong, tức là đỏ ở đây.
    expect(await choToi(() => soHuy > huyTruoc, 3_000)).toBe(true);
    expect(await choToi(() => soFlush > flushTruoc, 3_000)).toBe(true);

    thaChot();
  });

  it('chốt vận đơn nằm trên hàng đợi khác huỷ đơn và view count', () => {
    const chot = hangDoiCua(JOB_CHOT_VAN_DON);
    expect(chot).not.toBe(hangDoiCua(JOB_HUY_DON_QUA_HAN));
    expect(chot).not.toBe(hangDoiCua(JOB_FLUSH_VIEW_COUNT));
    // Huỷ đơn và view count giữ nguyên hàng đợi cũ: api vẫn xếp "báo hàng
    // mới" vào TEN_HANG_DOI, đổi tên là job của api không ai nhận.
    expect(hangDoiCua(JOB_HUY_DON_QUA_HAN)).toBe(TEN_HANG_DOI);
    expect(hangDoiCua(JOB_FLUSH_VIEW_COUNT)).toBe(TEN_HANG_DOI);
  });
});
