import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { TasksService } from '@ops/tasks/tasks.service';
import { LICH_LAP, TEN_HANG_DOI } from './jobs.constants';
import { taoBoXuLy } from './jobs.processor';
import { dangKyLichLap, donLichThua } from './jobs.schedule';

/**
 * Chủ sở hữu hàng đợi và worker BullMQ. CHỈ tiến trình worker nạp provider này.
 *
 * VÌ SAO DÙNG bullmq TRẦN CHỨ KHÔNG PHẢI @nestjs/bullmq.
 *
 * Điều quan trọng nhất ở task này là "worker chạy ở worker, KHÔNG chạy ở api".
 * @nestjs/bullmq dựng `Worker` ngầm khi thấy một lớp gắn `@Processor` trong
 * module — tiện, nhưng chỗ bật/tắt nằm trong thư viện. Với bullmq trần thì
 * `new Worker(...)` nằm ngay đây, đọc là thấy, và bài tự kiểm chỉ cần hỏi
 * "AppModule có nạp JobsModule không" là trả lời xong.
 *
 * Đổi lại phải tự dọn kết nối — làm trong onApplicationShutdown bên dưới.
 */
@Injectable()
export class JobsRunner implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JobsRunner.name);
  private conn?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly tasks: TasksService) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;

    // KHÔNG fail-open, và đây là ngoại lệ có chủ đích của cả repo.
    //
    // Cache hỏng thì đọc thẳng MySQL. Throttler hỏng thì cho request đi tiếp.
    // Cả hai đúng, vì người dùng vẫn được phục vụ. Worker thì ngược lại: một
    // worker "chạy tiếp" mà không có hàng đợi là một tiến trình sống nhăn
    // không làm gì — đơn quá hạn không ai huỷ, tiền ký quỹ không ai giải ngân,
    // và không request nào lỗi để ai đó nhận ra. Hỏng CÂM là kiểu hỏng tệ nhất
    // với việc chạy nền.
    //
    // Nên: ném. src/worker.ts bắt và thoát mã 1, `restart: unless-stopped`
    // dựng lại, và log có một dòng đọc được thay vì im lặng.
    if (!url) {
      throw new Error(
        'REDIS_URL trống. Worker KHÔNG chạy được nếu thiếu hàng đợi — ' +
          'đặt REDIS_URL rồi khởi động lại.',
      );
    }

    // maxRetriesPerRequest: null là BullMQ BẮT BUỘC (nó dùng lệnh chặn
    // `brpoplpush` chờ job, mà lệnh chặn thì không đếm lần thử lại được).
    // Đặt số ở đây thì bullmq ném ngay lúc dựng Worker.
    this.conn = new IORedis(url, { maxRetriesPerRequest: null });
    this.conn.on('error', (e) =>
      this.logger.error(`Kết nối Redis lỗi: ${e.message}`),
    );

    this.queue = new Queue(TEN_HANG_DOI, { connection: this.conn });

    const boXuLy = taoBoXuLy(this.tasks);
    this.worker = new Worker(TEN_HANG_DOI, (job) => boXuLy(job), {
      connection: this.conn.duplicate(),
      // MỘT job một lúc trong mỗi tiến trình. Hai job tiền này quét bảng orders
      // và gọi GHN; chạy chồng lên nhau không nhanh hơn, chỉ tranh kết nối.
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Job ${job?.name ?? '?'} hỏng: ${err.message}`),
    );
    this.worker.on('completed', (job) =>
      this.logger.log(`Job ${job.name} xong.`),
    );

    const thua = await donLichThua(this.queue);
    if (thua.length) {
      this.logger.warn(`Đã xoá ${thua.length} lịch cũ: ${thua.join(', ')}`);
    }
    await dangKyLichLap(this.queue);

    // In ra lịch ĐỌC TỪ REDIS chứ không in lại hằng số vừa gửi đi.
    //
    // In hằng số thì log luôn đúng kể cả khi việc ghi thất bại — đúng kiểu
    // "báo cáo thành công vì đã gọi hàm". Đọc ngược lại thì dòng log này là
    // bằng chứng lịch có thật trong Redis.
    for (const s of await this.queue.getJobSchedulers()) {
      this.logger.log(
        `Lịch: ${String(s.key ?? s.id)} — ${s.pattern} — kế tiếp ` +
          (s.next ? new Date(s.next).toISOString() : 'chưa tính'),
      );
    }
    this.logger.log(
      `Worker sẵn sàng trên hàng đợi "${TEN_HANG_DOI}" (${LICH_LAP.length} lịch).`,
    );
  }

  /**
   * Đóng worker TRƯỚC hàng đợi và kết nối.
   *
   * `worker.close()` đợi job đang chạy xong rồi mới nhả. Đóng kết nối trước là
   * cắt ngang một lượt huỷ đơn giữa chừng — mà lượt đó đang đụng tiền.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.conn?.disconnect();
  }
}
