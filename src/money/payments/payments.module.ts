import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '@ordering/orders/entities/order.entity';
import { Payment } from './entities/payment.entity';
import { User } from '@identity/users/entities/user.entity';
import { HttpModule } from '@nestjs/axios';
import { WalletsModule } from '@money/wallets/wallets.module';
import { EscrowsModule } from '@money/escrows/escrows.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
    TypeOrmModule.forFeature([Payment, User, Order]),
    WalletsModule,
    // Trả đơn bằng ví phải tách ký quỹ giống hệt đường PayOS — xem
    // `processOrderPayment` trong payments.service.ts.
    EscrowsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
