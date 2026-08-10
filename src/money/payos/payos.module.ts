import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayosService } from './payos.service';
import { PayosController } from './payos.controller';
import { Payment } from '@money/payments/entities/payment.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { User } from '@identity/users/entities/user.entity';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import { PayosWebhookLog } from './entities/payos-webhook-log.entity';
import { NotificationsModule } from '@messaging/notifications/notifications.module';
import { EscrowsModule } from '@money/escrows/escrows.module';
import { LedgerModule } from '@money/ledger/ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Order, User, Wallet, PayosWebhookLog]),
    NotificationsModule,
    EscrowsModule,
    LedgerModule,
  ],
  controllers: [PayosController],
  providers: [PayosService],
  exports: [PayosService],
})
export class PayosModule {}
