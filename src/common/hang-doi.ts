import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Hợp đồng của hàng đợi job nền, dùng chung giữa BÊN XẾP (api) và BÊN NHẬN
 * (worker, `src/ops/jobs/`).
 *
 * Đặt ở `common` vì bên xếp nằm ở tầng dưới (catalog) và không được phép
 * import `ops` (luật ranh giới trong eslint.config.mjs). `jobs.constants.ts`
 * xuất lại hai tên này, nên vẫn chỉ có MỘT chỗ gõ chuỗi: gõ lệch một ký tự là
 * job vào hàng rồi nằm đó không ai nhận.
 */
export const TEN_HANG_DOI = 'zoldify-jobs';

/** Job MỘT LẦN (không phải lịch lặp): báo hàng mới cho người theo dõi. */
export const JOB_BAO_HANG_MOI = 'bao-hang-moi';

/** Dữ liệu job báo hàng mới. Chỉ kiểu JSON thuần: BullMQ lưu nó trong Redis. */
export interface DuLieuBaoHangMoi {
  seller_id: number;
  seller_name: string;
  product_id: number;
  product_name: string;
  price: number;
  currency?: string;
}

/** Chờ Redis nhận job tối đa bấy nhiêu, quá thì coi như không xếp được. */
const HET_GIO_XEP_MS = 2_000;

/**
 * Bên XẾP job vào hàng đợi. Api dùng; worker cũng có bản này (qua
 * ProductsModule) nhưng không gọi tới nên không mở kết nối nào.
 *
 * FAIL-OPEN như cache và throttler: không có REDIS_URL, Redis chết, hay Redis
 * chậm quá 2 giây thì `them()` trả `false` chứ KHÔNG ném. Người gọi tự quyết
 * đường lùi; request của người dùng không được hỏng vì việc phụ chạy nền.
 *
 * Kết nối mở LƯỜI ở lần xếp đầu tiên: spec nào dựng ProductsService mà không
 * đăng bán thì không có socket Redis nào giữ jest sống (bài học 26/10 ở
 * `ProductsService` với kết nối đếm view_count).
 */
@Injectable()
export class HangDoiViecNen implements OnApplicationShutdown {
  private readonly logger = new Logger(HangDoiViecNen.name);
  private conn?: IORedis;
  private queue?: Queue;

  private layHangDoi(): Queue | null {
    if (this.queue) return this.queue;
    const url = process.env.REDIS_URL;
    if (!url) return null;
    // Không xếp lệnh khi mất kết nối, thử lại một lần: bên XẾP phải hỏng
    // nhanh để người gọi còn kịp đi đường lùi, khác hẳn Worker (bắt buộc
    // maxRetriesPerRequest: null vì dùng lệnh chặn).
    this.conn = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.conn.on('connect', () => {
      (
        this.conn as unknown as { stream?: { unref?: () => void } }
      ).stream?.unref?.();
    });
    this.conn.on('error', () => {
      // Sự kiện kết nối; lỗi của từng lần xếp đã được log ở `them()`.
    });
    this.queue = new Queue(TEN_HANG_DOI, { connection: this.conn });
    return this.queue;
  }

  /**
   * Xếp một job. `jobId` (nếu có) để BullMQ bỏ qua lần xếp trùng; không được
   * chứa dấu ':' (BullMQ 5 ném "Custom Id cannot contain :").
   */
  async them(ten: string, data: object, jobId?: string): Promise<boolean> {
    let hangDoi: Queue | null;
    try {
      hangDoi = this.layHangDoi();
    } catch (e) {
      this.logger.warn(`Không dựng được hàng đợi: ${(e as Error).message}`);
      return false;
    }
    if (!hangDoi) return false;

    let hen: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        hangDoi.add(ten, data, {
          jobId,
          removeOnComplete: 1000,
          removeOnFail: 5000,
        }),
        new Promise((_, tuChoi) => {
          hen = setTimeout(
            () =>
              tuChoi(new Error(`Redis không nhận job sau ${HET_GIO_XEP_MS}ms`)),
            HET_GIO_XEP_MS,
          );
          hen.unref();
        }),
      ]);
      return true;
    } catch (e) {
      this.logger.warn(`Không xếp được job ${ten}: ${(e as Error).message}`);
      return false;
    } finally {
      if (hen) clearTimeout(hen);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    this.conn?.disconnect();
  }
}
