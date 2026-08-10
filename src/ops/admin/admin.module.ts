import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '@identity/users/entities/user.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Setting } from '@ops/settings/entities/setting.entity';
import { Withdrawal } from '@money/withdrawals/entities/withdrawal.entity';
import { WithdrawalsModule } from '@money/withdrawals/withdrawals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Order, Product, Setting, Withdrawal]),
    WithdrawalsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule { }
