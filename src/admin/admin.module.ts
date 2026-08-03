import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Order } from 'src/orders/entities/order.entity';
import { Product } from 'src/products/entities/product.entity';
import { Setting } from 'src/settings/entities/setting.entity';
import { Withdrawal } from 'src/withdrawals/entities/withdrawal.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Order, Product, Setting, Withdrawal])],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule { }
