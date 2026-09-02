import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import Redis from 'ioredis';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ThrottlerStorageFailOpen } from './common/throttler-fail-open';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { AppController } from './app.controller';
import { mailerConfig } from './common/mailer.config';
import { cacheConfig } from './common/cache.config';
import { JwtModule } from '@nestjs/jwt';
import { MaintenanceGuard } from './common/guards/maintenance.guard';
import { AppService } from './app.service';
import { UsersModule } from '@identity/users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '@identity/auth/auth.module';
import { CategoriesModule } from '@catalog/categories/categories.module';
import { ProductsModule } from '@catalog/products/products.module';
import { OrdersModule } from '@ordering/orders/orders.module';
import { PaymentsModule } from '@money/payments/payments.module';
import { ChatModule } from '@messaging/chat/chat.module';
import { AddressesModule } from '@identity/addresses/addresses.module';
import { NotificationsModule } from '@messaging/notifications/notifications.module';
import { InteractionsModule } from '@catalog/interactions/interactions.module';
import { CartModule } from '@ordering/carts/cart.module';
import { FilesModule } from '@catalog/files/files.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { FollowsModule } from '@catalog/follows/follows.module';
import { ShopModule } from '@catalog/shop/shop.module';
import { FirebaseModule } from '@messaging/firebase/firebase.module';
import { GhnModule } from '@ordering/ghn/ghn.module';
import { EscrowsModule } from '@money/escrows/escrows.module';
import { PayosModule } from '@money/payos/payos.module';
import { WalletsModule } from '@money/wallets/wallets.module';
import { SitemapModule } from '@catalog/sitemap/sitemap.module';
import { HealthModule } from '@ops/health/health.module';
import { RequestIdMiddleware } from '@common/request-id.middleware';
import { AdminModule } from '@ops/admin/admin.module';
import { SettingsModule } from '@ops/settings/settings.module';
import { WithdrawalsModule } from '@money/withdrawals/withdrawals.module';
import { LedgerModule } from '@money/ledger/ledger.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Cache env-bridge (12-factor: khác biệt dev/prod nằm ở CONFIG, không ở CODE).
    //   - Có REDIS_URL  → dùng Redis qua Keyv (production trên máy chủ Linux).
    //   - Không có       → in-memory mặc định (dev/test local, không cần Redis).
    //
    // Thân hàm chuyển sang src/common/cache.config.ts ở task #14: tiến trình
    // worker cũng cần CACHE_MANAGER (ProductsService inject nó) và hai tiến
    // trình PHẢI trỏ vào cùng một cache — lý do đầy đủ ghi trong file đó.
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: cacheConfig,
    }),
    UsersModule,
    // Throttler đếm CHUNG qua Redis (task #5).
    //
    // Trước đây `forRoot` không khai `storage`, nên mỗi tiến trình api đếm
    // riêng trong RAM. Với 3 bản api, giới hạn "10 request/giây" thật ra là 30
    // — và không có lỗi nào được ném ra để ai biết điều đó. Rate limit vẫn
    // trông như đang hoạt động. Đó là kiểu hỏng chỉ lộ ra khi có người thật sự
    // cố lạm dụng, tức là lúc muộn nhất.
    //
    // Cùng quy ước env-bridge với cache ngay bên trên: có REDIS_URL thì dùng
    // Redis, không có thì giữ nguyên in-memory. Máy dev không cần Redis.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const throttlers = [
          { name: 'short', ttl: 1000, limit: 10 },
          { name: 'medium', ttl: 10000, limit: 50 },
          { name: 'long', ttl: 60000, limit: 300 },
        ];
        const url = process.env.REDIS_URL;
        if (!url) return { throttlers };

        // Tự tạo client thay vì đưa URL cho thư viện, vì hai tuỳ chọn dưới đây
        // quyết định app sống hay chết khi Redis hỏng:
        //
        //   enableOfflineQueue: false — mặc định ioredis XẾP HÀNG lệnh khi mất
        //     kết nối và chờ. Với throttler, nghĩa là mọi request treo cho tới
        //     khi Redis trở lại. Tắt đi thì lệnh hỏng ngay, và lớp fail-open
        //     bên dưới cho request đi tiếp. Hỏng nhanh tốt hơn treo lâu.
        //   .on('error') — client ioredis không có listener 'error' sẽ ném lỗi
        //     chưa bắt và giết cả tiến trình Node.
        const client = new Redis(url, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        client.on('error', () => {
          // Nuốt ở đây có chủ đích: ThrottlerStorageFailOpen đã ghi log có
          // tiết chế. Ghi thêm ở đây là ngập log đúng lúc đang có sự cố.
        });

        return {
          throttlers,
          storage: new ThrottlerStorageFailOpen(
            new ThrottlerStorageRedisService(client),
          ),
        };
      },
    }),
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST') || 'localhost',
        port: configService.get<number>('DB_PORT') || 3306,
        username: configService.get<string>('DB_USERNAME') || 'root',
        password: configService.get<string>('DB_PASSWORD') || '',
        database: configService.get<string>('DB_DATABASE') || 'zoldify',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        migrationsRun: false,
        extra: {
          // 15 chứ không phải 50 — task #5 bảng phân công.
          //
          // Con số này KHÔNG phải "càng to càng nhanh". Nó là số kết nối mà MỘT
          // tiến trình API được phép giữ, và sơ đồ deployment dự tính chạy 3 bản
          // api. MySQL mặc định `max_connections = 151`. Với 50, ba bản api ăn
          // hết 150 — chạm trần, không còn chỗ cho `migrate`, cho backup
          // mysqldump hằng đêm, hay cho một phiên soi database lúc sự cố. Thứ
          // hỏng trước sẽ là những thứ mình cần nhất đúng lúc đang hỏng.
          //
          // 15 × 3 = 45, còn dư rộng. Và một tiến trình Node đơn luồng không
          // dùng hết 50 kết nối song song: quá ngưỡng nào đó, thêm kết nối chỉ
          // chuyển hàng đợi từ trong ứng dụng sang trong MySQL, nơi nó đắt hơn.
          connectionLimit: 15,
        },
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    CategoriesModule,
    ProductsModule,
    OrdersModule,
    PaymentsModule,
    ChatModule,
    NotificationsModule,
    InteractionsModule,
    CartModule,
    FilesModule,
    AddressesModule,
    // Bản này từng đóng cứng smtp.gmail.com:587, bỏ qua EMAIL_HOST/EMAIL_PORT
    // mà file mẫu vẫn ghi là đọc được — đổi sang nhà cung cấp khác thì hai biến
    // đó im lặng không có tác dụng.
    MailerModule.forRootAsync({
      imports: [ConfigModule, FollowsModule],
      useFactory: mailerConfig,
      inject: [ConfigService],
    }),
    FollowsModule,
    ShopModule,
    FirebaseModule,
    GhnModule,
    EscrowsModule,
    PayosModule,
    WalletsModule,
    SitemapModule,
    HealthModule,
    AdminModule,
    SettingsModule,
    WithdrawalsModule,

    LedgerModule,

    // JwtService cho MaintenanceGuard. Guard toàn cục được dựng trong injector
    // của module GỐC, mà JwtModule tới giờ chỉ khai bên trong AuthModule — nên
    // Nest không dựng nổi guard và chết ngay lúc khởi động với
    // "Nest can't resolve dependencies of the MaintenanceGuard (…, ?, …)".
    // register({}) rỗng là đủ: guard truyền secret tường minh khi verify.
    JwtModule.register({}),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Đăng ký SAU ThrottlerGuard: guard toàn cục chạy theo đúng thứ tự khai ở
    // đây, và chặn bảo trì thì nên nằm sau chặn spam. Nó cũng cần req.user do
    // JwtAuthGuard gắn vào — guard cấp route chạy trước guard toàn cục trong
    // Nest, nên tới lượt nó thì vai trò đã biết.
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
  ],
})
// `configure` chứ không phải một interceptor toàn cục: middleware chạy TRƯỚC
// mọi guard, pipe và interceptor, nên cả request bị chặn ở guard (401, 429)
// cũng có mã request và cũng được ghi lại. Đặt ở interceptor thì đúng những
// request bị từ chối — thứ hay phải đi tra nhất — lại không có dòng nào.
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
