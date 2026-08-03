import { Module } from '@nestjs/common';
import { SepayService } from './sepay.service';
import { SepayController } from './sepay.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from 'src/orders/entities/order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  controllers: [SepayController],
  providers: [SepayService],
})
export class SepayModule {}
