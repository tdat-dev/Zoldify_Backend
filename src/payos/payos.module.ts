import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayosService } from './payos.service';
import { PayosController } from './payos.controller';
import { Payment } from '../payments/entities/payment.entity';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { PayosWebhookLog } from './entities/payos-webhook-log.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { EscrowsModule } from '../escrows/escrows.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Order, User, Wallet, PayosWebhookLog]),
    NotificationsModule,
    EscrowsModule,
    SettingsModule,
  ],
  controllers: [PayosController],
  providers: [PayosService],
  exports: [PayosService],
})
export class PayosModule { }
