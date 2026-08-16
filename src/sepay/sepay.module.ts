import { Module } from '@nestjs/common';
import { SepayService } from './sepay.service';
import { SepayController } from './sepay.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from 'src/orders/entities/order.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([Order]), SettingsModule],
  controllers: [SepayController],
  providers: [SepayService],
})
export class SepayModule {}
