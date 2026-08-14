import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrdersModule } from '@ordering/orders/orders.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Chỉ cần đọc để TÌM đơn quá hạn; việc huỷ do OrdersService làm.
    TypeOrmModule.forFeature([Order]),
    OrdersModule,
  ],
  providers: [TasksService],
})
export class TasksModule {}
