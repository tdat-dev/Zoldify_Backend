import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrdersModule } from '@ordering/orders/orders.module';

/**
 * Hai việc chạy nền của sàn.
 *
 * `ScheduleModule.forRoot()` đã BỎ ở task #14. Nó là bộ hẹn giờ trong tiến
 * trình: module này được AppModule nạp, nên mỗi bản api dựng lên là một bộ hẹn
 * giờ nữa cùng đếm tới cùng một giờ. Lịch nay nằm trong Redis và chỉ tiến trình
 * worker nhận job — xem src/ops/jobs/.
 *
 * Module này giờ chỉ còn cung cấp TasksService cho JobsModule gọi.
 */
@Module({
  imports: [
    // Chỉ cần đọc để TÌM đơn quá hạn; việc huỷ do OrdersService làm.
    TypeOrmModule.forFeature([Order]),
    OrdersModule,
  ],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
