import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { MaintenanceGuard } from './common/guards/maintenance.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager'
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ChatModule } from './chat/chat.module';
import { AddressesModule } from './addresses/addresses.module';
import { NotificationsModule } from './notifications/notifications.module';
import { InteractionsModule } from './interactions/interactions.module';
import { CartModule } from './carts/cart.module';
import { FilesModule } from './files/files.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { FollowsModule } from './follows/follows.module';
import { ShopModule } from './shop/shop.module';
import { FirebaseModule } from './firebase/firebase.module';
import { SepayModule } from './sepay/sepay.module';
import { GhnModule } from './ghn/ghn.module';
import { EscrowsModule } from './escrows/escrows.module';
import { PayosModule } from './payos/payos.module';
import { WalletsModule } from './wallets/wallets.module';
import { TasksModule } from './tasks/tasks.module';
import { SitemapModule } from './sitemap/sitemap.module';
import { AdminModule } from './admin/admin.module';
import { SettingsModule } from './settings/settings.module';
import { SettingsService } from './settings/settings.service';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
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
        synchronize: true,
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
      imports: [ConfigModule, SettingsModule, FollowsModule],
      useFactory: async (configService: ConfigService, settingsService: SettingsService) => {
        const host = await settingsService.getValue('smtp_host') || 'smtp.gmail.com';
        const portStr = await settingsService.getValue('smtp_port');
        const port = portStr ? parseInt(portStr, 10) : 587;
        const user = await settingsService.getValue('smtp_user') || configService.get<string>('EMAIL_USER');
        const pass = await settingsService.getValue('smtp_pass') || configService.get<string>('EMAIL_APP_PASSWORD');
        const fromName = await settingsService.getValue('smtp_from_name') || 'Zoldify';
        const fromEmail = await settingsService.getValue('smtp_from_email') || user;

        return {
          transport: {
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
          },
          defaults: {
            from: `"${fromName}" <${fromEmail}>`,
          },
        };
      },
      inject: [ConfigService, SettingsService],
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
