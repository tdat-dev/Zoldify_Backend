import { Global, Module, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_PHAT, StockEventsService } from './stock-events.service';

/**
 * BÊN PHÁT của tồn kho real-time — và CHỈ bên phát.
 *
 * Tách khỏi `StockModule` (chứa gateway) vì hai tiến trình cần hai nửa khác
 * nhau:
 *
 *   api     cần cả hai — nó đổi kho VÀ phục vụ socket
 *   worker  chỉ cần nửa này — `cancelExpired` hoàn kho mỗi giờ, nhưng worker
 *           KHÔNG có socket server
 *
 * Nhét gateway vào `WorkerModule` là dựng một Socket.IO server thứ hai không ai
 * nối vào. `worker.module.ts` đã viết sẵn lý do không dùng lại `AppModule`:
 * ranh giới "API làm gì, worker làm gì" biến mất ngay lúc dùng chung module gốc.
 *
 * `@Global` vì ba chỗ đổi kho nằm ở ba module khác nhau (`OrdersModule`,
 * `ProductsModule`) và cả hai tiến trình đều cần. Nếu không, mỗi module phải tự
 * `imports: [StockEventsModule]` và quên một chỗ là mất một đường phát — lặng
 * lẽ, vì thiếu sự kiện thì không có gì đỏ.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_PHAT,
      useFactory: (): Redis | null => {
        const url = process.env.REDIS_URL;
        if (!url) {
          // KHÔNG chặn boot. Tồn kho real-time là tiện ích: thiếu nó thì trang
          // sản phẩm vẫn đúng khi tải lại, chỉ là không tự cập nhật. Cùng lựa
          // chọn với `cache.config.ts` — xem comment ở đó.
          return null;
        }

        // Ba tuỳ chọn dưới đây lấy nguyên từ `app.module.ts` (throttler), và
        // chúng quyết định app sống hay chết khi Redis hỏng:
        //
        //   enableOfflineQueue: false — mặc định ioredis XẾP HÀNG lệnh khi mất
        //     kết nối và chờ. Ở đây nghĩa là mỗi lượt đặt hàng treo thêm cho
        //     tới khi Redis trở lại. Hỏng nhanh tốt hơn treo lâu; lệnh hỏng thì
        //     `StockEventsService.phat` nuốt và đi tiếp.
        //   maxRetriesPerRequest: 1 — cùng lý do.
        //   .on('error') — client ioredis KHÔNG có listener 'error' sẽ ném lỗi
        //     chưa bắt và GIẾT CẢ TIẾN TRÌNH NODE.
        const client = new Redis(url, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        client.on('error', () => {
          // Nuốt có chủ đích: `phat()` đã ghi log có tiết chế khi lệnh hỏng.
          // Ghi thêm ở đây là ngập log đúng lúc đang có sự cố.
        });
        return client;
      },
    },
    StockEventsService,
  ],
  exports: [StockEventsService],
})
export class StockEventsModule {
  private readonly logger = new Logger(StockEventsModule.name);

  constructor() {
    if (!process.env.REDIS_URL) {
      this.logger.warn(
        'REDIS_URL trống — tồn kho real-time TẮT (task #26b). ' +
          'Trang sản phẩm vẫn đúng khi tải lại.',
      );
    }
  }
}
