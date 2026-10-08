import {
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { KENH_TON_KHO } from './stock-events.service';
import { StockGateway } from './stock.gateway';

/** Token tiêm cho client Redis dùng để SUBSCRIBE. */
export const REDIS_NHAN = 'REDIS_NHAN_TON_KHO';

/**
 * BÊN NHẬN của tồn kho real-time. **Chỉ `AppModule` được nhập module này.**
 *
 * `WorkerModule` nhập `StockEventsModule` (bên phát) thôi — xem lý do ở đó.
 */
@Module({
  providers: [
    {
      provide: REDIS_NHAN,
      useFactory: (): Redis | null => {
        const url = process.env.REDIS_URL;
        if (!url) return null;

        // KẾT NỐI RIÊNG, KHÔNG DÙNG LẠI CLIENT PHÁT.
        //
        // Đây là ràng buộc của chính Redis, không phải lựa chọn: một kết nối đã
        // vào chế độ subscribe thì CHỈ còn nhận được lệnh subscribe/unsubscribe.
        // Dùng chung client với bên phát là `publish` sẽ báo lỗi
        // "Connection in subscriber mode, only subscriber commands may be used",
        // và nó hỏng ngay ở lượt trừ kho đầu tiên.
        //
        // KHÔNG đặt `enableOfflineQueue: false` ở đây, ngược với client phát:
        // lệnh duy nhất client này gửi là một `SUBSCRIBE` lúc khởi động. Hỏng
        // nhanh ở đó nghĩa là không bao giờ nghe lại được sau khi Redis trở
        // lại — trong khi ioredis tự nối lại và tự gửi lại subscribe.
        const client = new Redis(url);
        client.on('error', () => {
          // Thiếu listener 'error' là giết cả tiến trình Node.
        });
        return client;
      },
    },
    StockGateway,
  ],
  exports: [StockGateway],
})
export class StockModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StockModule.name);

  constructor(
    @Optional() @Inject(REDIS_NHAN) private readonly redis: Redis | null,
    private readonly gateway: StockGateway,
  ) {}

  onModuleInit(): void {
    if (!this.redis) return;

    // `subscribe` rồi mới gắn listener: ioredis tự gửi lại SUBSCRIBE sau mỗi
    // lần nối lại, nên không cần tự xử lý việc đó.
    void this.redis.subscribe(KENH_TON_KHO, (err) => {
      if (err) {
        this.logger.warn(
          `Không nghe được kênh ${KENH_TON_KHO}: ${err.message}. ` +
            'Tồn kho real-time tắt cho bản api này.',
        );
      }
    });

    this.redis.on('message', (kenh: string, tin: string) => {
      if (kenh !== KENH_TON_KHO) return;
      this.gateway.nhanTuRedis(tin);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // Đóng tường minh: một kết nối subscribe đang treo giữ tiến trình không
    // thoát, và `docker compose down` sẽ phải chờ hết giờ rồi SIGKILL.
    await this.redis?.quit().catch(() => undefined);
  }
}
