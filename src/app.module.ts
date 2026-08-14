import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { AppController } from './app.controller';
import { mailerConfig } from './common/mailer.config';
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
import { TasksModule } from '@ops/tasks/tasks.module';
import { SitemapModule } from '@catalog/sitemap/sitemap.module';
import { AdminModule } from '@ops/admin/admin.module';
import { SettingsModule } from '@ops/settings/settings.module';
import { WithdrawalsModule } from '@money/withdrawals/withdrawals.module';
import { LedgerModule } from '@money/ledger/ledger.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: 60000,
    }),
    UsersModule,
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 10000, limit: 50 },
      { name: 'long', ttl: 60000, limit: 300 },
    ]),
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
          connectionLimit: 50,
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
    TasksModule,
    SitemapModule,
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
export class AppModule {}
