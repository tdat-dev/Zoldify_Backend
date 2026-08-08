import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager'
import { AppController } from './app.controller';
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
import { SepayModule } from '@money/sepay/sepay.module';
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
    MailerModule.forRootAsync({
      imports: [ConfigModule,FollowsModule],
      useFactory: async (configService: ConfigService) => ({
        transport: {
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
          auth: {
            user: configService.get<string>('EMAIL_USER'),
            pass: configService.get<string>('EMAIL_APP_PASSWORD'),
          },
        },
        defaults: {
          from: `"Zoldify" <${configService.get<string>('EMAIL_USER')}>`,
        },
      }),
      inject: [ConfigService],
    }),
    FollowsModule,
    ShopModule,
    FirebaseModule,
    SepayModule,
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
