import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { urlHangDoi } from '@common/hang-doi';
import { TasksService } from '@ops/tasks/tasks.service';
import { ProductsService } from '@catalog/products/products.service';
import {
  LICH_LAP,
  TEN_HANG_DOI,
  TEN_HANG_DOI_VAN_DON,
  lichCuaHangDoi,
} from './jobs.constants';
import { taoBoXuLy } from './jobs.processor';
import { dangKyLichLap, donLichThua, GIU_JOB_LICH_LAP } from './jobs.schedule';

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
  private readonly queues: Queue[] = [];
  private readonly workers: Worker[] = [];
  private readonly connsWorker: IORedis[] = [];

  constructor(
    private readonly tasks: TasksService,
    private readonly products: ProductsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // QUEUE_REDIS_URL (redis-queue, noeviction), thiếu thì REDIS_URL. Cùng
    // một hàm với bên xếp ở api, xem `urlHangDoi`.
    const url = urlHangDoi();

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
        'QUEUE_REDIS_URL và REDIS_URL đều trống. Worker KHÔNG chạy được ' +
          'nếu thiếu hàng đợi: đặt một trong hai rồi khởi động lại.',
      );
    }

    // maxRetriesPerRequest: null là BullMQ BẮT BUỘC (nó dùng lệnh chặn
    // `brpoplpush` chờ job, mà lệnh chặn thì không đếm lần thử lại được).
    // Đặt số ở đây thì bullmq ném ngay lúc dựng Worker.
    this.conn = new IORedis(url, { maxRetriesPerRequest: null });
    this.conn.on('error', (e) =>
      this.logger.error(`Kết nối Redis lỗi: ${e.message}`),
    );

    // Ghép hai nguồn việc: ba job lịch lặp của TasksService và job "báo hàng
    // mới" của ProductsService (rà soát 26/10 mục 6). Ghép ở đây thay vì nhét
    // ProductsService vào TasksService: TasksService được dựng bằng tay trong
    // spec, thêm tham số là sửa cả loạt spec không liên quan.
    //
    // MỘT bộ xử lý cho CẢ HAI hàng đợi, nhận mọi tên job: job "chot-van-don"
    // đã nằm sẵn trong hàng đợi chính lúc deploy bản tách hàng đợi vẫn có
    // người nhận, thay vì failed vì "không có bộ xử lý".
    const boXuLy = taoBoXuLy({
      autoCancelOrders: () => this.tasks.autoCancelOrders(),
      settleDeliveredShipments: () => this.tasks.settleDeliveredShipments(),
      flushViewCount: () => this.tasks.flushViewCount(),
      phatThongBaoHangMoi: (d) => this.products.phatThongBaoHangMoi(d),
    });

    // HAI hàng đợi, mỗi hàng đợi một Worker concurrency 1 (rà soát "1 triệu
    // dòng" 28/10, xem TEN_HANG_DOI_VAN_DON). Chốt vận đơn chạy tới 20 phút khi
    // GHN chậm; chung một hàng đợi thì huỷ đơn quá hạn và đổ view count chờ
    // suốt quãng đó. Tách ra thì hai loại job chạy song song, nhưng MỖI loại
    // vẫn chỉ một lượt một lúc: hai lượt huỷ đơn chồng nhau không nhanh hơn,
    // chỉ tranh khoá dòng và kết nối.
    //
    // Kết nối MySQL: worker có 5. Hàng đợi chính dùng 1, chốt vận đơn tối đa 4
    // (4 lô hỏi GHN song song, xem GIOI_HAN_DONG_BO), vừa đủ, không ai chờ.
    for (const ten of [TEN_HANG_DOI, TEN_HANG_DOI_VAN_DON]) {
      // Mặc định cho job xếp bằng CHÍNH hàng đợi này (không qua lịch lặp),
      // cùng giới hạn với lịch lặp: thiếu thì job xong nằm lại Redis mãi (xem
      // GIU_JOB_LICH_LAP trong jobs.schedule.ts).
      const queue = new Queue(ten, {
        connection: this.conn,
        defaultJobOptions: GIU_JOB_LICH_LAP,
      });
      this.queues.push(queue);

      // Giữ kết nối duplicate() để tự đóng: BullMQ không đóng kết nối người
      // gọi truyền vào. Bỏ sót thì tiến trình không thoát sau shutdown (bài
      // hang-doi-van-don.spec.ts treo jest đúng vì thế).
      const connWorker = this.conn.duplicate();
      this.connsWorker.push(connWorker);
      const worker = new Worker(ten, (job) => boXuLy(job), {
        connection: connWorker,
        concurrency: 1,
      });
      worker.on('failed', (job, err) =>
        this.logger.error(`Job ${job?.name ?? '?'} hỏng: ${err.message}`),
      );
      worker.on('completed', (job) => this.logger.log(`Job ${job.name} xong.`));
      this.workers.push(worker);

      // Dọn lịch thừa THEO TỪNG hàng đợi: lần deploy đầu sau khi tách, lịch
      // "chot-van-don" cũ còn trên hàng đợi chính. Không xoá thì nó vẫn đẻ job
      // ở đó mỗi giờ, cộng với lịch mới bên hàng đợi vận đơn: chốt vận đơn
      // chạy HAI lần mỗi giờ, đúng con bệnh task #14 đi chữa.
      const lich = lichCuaHangDoi(ten);
      const thua = await donLichThua(queue, lich);
      if (thua.length) {
        this.logger.warn(
          `Đã xoá ${thua.length} lịch cũ trên "${ten}": ${thua.join(', ')}`,
        );
      }
      await dangKyLichLap(queue, lich);

      // In ra lịch ĐỌC TỪ REDIS chứ không in lại hằng số vừa gửi đi.
      //
      // In hằng số thì log luôn đúng kể cả khi việc ghi thất bại, đúng kiểu
      // "báo cáo thành công vì đã gọi hàm". Đọc ngược lại thì dòng log này là
      // bằng chứng lịch có thật trong Redis.
      for (const s of await queue.getJobSchedulers()) {
        this.logger.log(
          `Lịch [${ten}]: ${String(s.key ?? s.id)}: ${s.pattern}, kế tiếp ` +
            (s.next ? new Date(s.next).toISOString() : 'chưa tính'),
        );
      }
    }
    this.logger.log(
      `Worker sẵn sàng trên ${this.queues.length} hàng đợi ` +
        `(${LICH_LAP.length} lịch).`,
    );
  }

  /**
   * Đóng worker TRƯỚC hàng đợi và kết nối.
   *
   * `worker.close()` đợi job đang chạy xong rồi mới nhả. Đóng kết nối trước là
   * cắt ngang một lượt huỷ đơn giữa chừng — mà lượt đó đang đụng tiền.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all(this.queues.map((q) => q.close()));
    for (const c of this.connsWorker) c.disconnect();
    this.conn?.disconnect();
  }
}
