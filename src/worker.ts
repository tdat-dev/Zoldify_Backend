import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

/**
 * Điểm vào của TIẾN TRÌNH WORKER (task #14).
 *
 *   node dist/worker        # production, xem service `worker` trong compose
 *   npm run start:worker    # máy cá nhân
 *
 * `createApplicationContext` chứ không `create`: worker không phục vụ HTTP.
 * Không cổng, không middleware, không Swagger — chỉ đồ thị DI và hàng đợi.
 *
 * Kèm theo: container worker phải TẮT cái HEALTHCHECK khai trong Dockerfile.
 * Healthcheck đó gọi `fetch` vào PORT, mà tiến trình này không mở cổng nào,
 * nên để nguyên là container `unhealthy` vĩnh viễn — và mọi thứ đọc trạng thái
 * đó (depends_on, cảnh báo giám sát sau này) đều đọc sai. docker-compose.yml
 * ghi đè, selfcheck-worker.ts canh.
 */
async function bootstrap() {
  const logger = new Logger('worker');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    // Bật để onApplicationShutdown trong JobsRunner được gọi khi nhận SIGTERM.
    //
    // Không có dòng này thì `docker compose down` giết tiến trình ngay giữa một
    // lượt huỷ đơn — mà lượt đó đang hoàn tiền ký quỹ. Có nó thì worker đóng
    // hàng đợi tử tế: job đang chạy được chạy nốt, job chưa nhận trả về hàng
    // cho lần khởi động sau.
    bufferLogs: false,
  });
  app.enableShutdownHooks();

  logger.log('Worker đã khởi động. Cron KHÔNG còn chạy trong tiến trình API.');
}

/**
 * Hỏng lúc khởi động thì CHẾT, không chạy tiếp.
 *
 * Cả repo này fail-open và đó là lựa chọn đúng ở nơi có người dùng đang chờ:
 * cache hỏng thì đọc thẳng MySQL, throttler hỏng thì cho request đi tiếp. Ở đây
 * thì ngược lại. Một worker khởi động hỏng mà vẫn giữ tiến trình sống là một
 * container `Up`, log sạch, và không job nào chạy: đơn quá hạn không ai huỷ,
 * tiền ký quỹ nằm im, không request nào lỗi để ai đó nhận ra. Im lặng là kiểu
 * hỏng tệ nhất với việc chạy nền.
 *
 * Thoát mã 1 để `restart: unless-stopped` dựng lại, và để `docker compose ps`
 * hiện đúng trạng thái thay vì nói dối.
 */
bootstrap().catch((e: unknown) => {
  new Logger('worker').error(
    `Worker KHÔNG khởi động được: ${(e as Error).message}`,
  );
  process.exit(1);
});
