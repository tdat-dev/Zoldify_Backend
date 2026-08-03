import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from 'src/orders/entities/order.entity';
import { Payment } from './entities/payment.entity';
import { User } from 'src/users/entities/user.entity';
import { HttpModule } from '@nestjs/axios';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 30000, maxRedirects: 5 }),
    TypeOrmModule.forFeature([Payment, User, Order]),
    WalletsModule
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule { }
