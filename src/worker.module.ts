import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from '@ops/jobs/jobs.module';
import { cacheConfig } from './common/cache.config';

/**
 * Module gốc của TIẾN TRÌNH WORKER. Song song với AppModule, không phải con nó.
 *
 * VÌ SAO KHÔNG DÙNG LẠI AppModule RỒI TẮT BỚT.
 *
 * Cách đó ngắn hơn nhưng worker sẽ dựng toàn bộ controller, ChatGateway, hai
 * guard toàn cục và Swagger — tức là một bản api thứ hai chỉ khác ở chỗ không
 * gọi `listen()`. Nó mở thêm kết nối Socket.IO, thêm một bộ nhớ cache, và nếu
 * mai ai đó thêm một `onModuleInit` chạy nền vào một module bất kỳ thì worker
 * lặng lẽ chạy cái đó nữa. Ranh giới "API làm gì, worker làm gì" biến mất ngay
 * lúc dùng chung một module gốc.
 *
 * Ở đây liệt kê ĐÚNG thứ worker cần: cấu hình, database, và hàng đợi job.
 * JobsModule kéo theo TasksModule → OrdersModule, tức là vẫn có escrow và
 * payos — cần thật, vì việc huỷ đơn đi qua đó.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Worker cũng cần CACHE_MANAGER.
    //
    // Không phải để đọc nhanh — mà vì đồ thị phụ thuộc bắt phải có: JobsModule
    // → TasksModule → OrdersModule → ProductsModule, và `ProductsService`
    // `@Inject(CACHE_MANAGER)`. Thiếu nó thì Nest không dựng nổi worker.
    //
    // Đây là lỗi đã dính thật khi làm task #14 và bài tự kiểm 26 mục KHÔNG bắt
    // được: nó hỏi "worker.ts có tồn tại không", không hỏi "worker có dựng
    // được không". Chỉ tới lúc chạy `node dist/worker` mới lộ. Nay
    // selfcheck-worker.ts dựng WorkerModule thật để lỗi này không tái diễn.
    //
    // Dùng CHUNG cấu hình với API (cùng Redis) chứ không cấp cache riêng — lý
    // do ghi trong src/common/cache.config.ts.
    CacheModule.registerAsync({ isGlobal: true, useFactory: cacheConfig }),

    // Cấu hình database chép từ AppModule chứ không tách ra file chung.
    //
    // Chép có chủ ý: hai tiến trình này KHÔNG nên có cùng cấu hình. Khác biệt
    // nằm ở connectionLimit ngay dưới, và gộp vào một hàm dùng chung sẽ che mất
    // đúng cái khác biệt đó. Phần còn lại (host, entities, migrations) mà lệch
    // thì worker không kết nối được và biết ngay lúc khởi động, không âm thầm.
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'mysql' as const,
        host: configService.get<string>('DB_HOST') || 'localhost',
        port: configService.get<number>('DB_PORT') || 3306,
        username: configService.get<string>('DB_USERNAME') || 'root',
        password: configService.get<string>('DB_PASSWORD') || '',
        database: configService.get<string>('DB_DATABASE') || 'zoldify',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        migrations: [__dirname + '/migrations/*{.ts,.js}'],

        // Worker KHÔNG BAO GIỜ chạy migration.
        //
        // Nó dựng cùng lúc với api, nên để nó tự migrate là hai tiến trình cùng
        // đổi lược đồ một lúc — đúng lý do docker-compose.yml tách hẳn service
        // `migrate` ra thành bước riêng. Ở compose, worker chờ `migrate` xong.
        migrationsRun: false,

        extra: {
          // 5, không phải 50 như api.
          //
          // Worker chạy MỘT job một lúc (concurrency: 1 trong JobsRunner) và
          // chỉ mỗi giờ một lần. Nó không cần hồ kết nối bằng api. Mà chỗ này
          // đáng tiếc từng máu: MySQL mặc định `max_connections=151`; api để 50
          // nên ba bản api đã là 150 — chạm trần. Thêm worker vào cụm mà cũng
          // xin 50 nữa thì tiến trình dựng sau bị từ chối kết nối, và tiến
          // trình đó rất có thể là worker: api dựng trước vì nó phục vụ người
          // dùng. Lúc đó cron chết câm, đúng kiểu hỏng tệ nhất.
          connectionLimit: 5,
        },
      }),
      inject: [ConfigService],
    }),

    JobsModule,
  ],
})
export class WorkerModule {}
