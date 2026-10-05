import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowsService } from './escrows.service';
import { EscrowsController } from './escrows.controller';
import { Escrow } from './entities/escrow.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { User } from '@identity/users/entities/user.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { LedgerModule } from '@money/ledger/ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Escrow, Order, User, OrderItem]),
    LedgerModule,
  ],
  controllers: [EscrowsController],
  providers: [EscrowsService],
  exports: [EscrowsService],
})
export class EscrowsModule {}
