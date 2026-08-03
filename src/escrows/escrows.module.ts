import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowsService } from './escrows.service';
import { EscrowsController } from './escrows.controller';
import { Escrow } from './entities/escrow.entity';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { OrderItem } from '../orders/entities/order-item.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Escrow, Order, User, OrderItem])],
  controllers: [EscrowsController],
  providers: [EscrowsService],
  exports: [EscrowsService],
})
export class EscrowsModule { }