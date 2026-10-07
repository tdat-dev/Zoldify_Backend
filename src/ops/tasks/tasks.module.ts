import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { Order } from '@ordering/orders/entities/order.entity';
import { Product } from '@catalog/products/entities/product.entity';
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
    // `Order` — chỉ cần đọc để TÌM đơn quá hạn; việc huỷ do OrdersService làm.
    //
    // `Product` — `flushViewCount` cộng lượt xem từ Redis về cột
    // `products.view_count`.
    //
    // THIẾU `Product` Ở ĐÂY LÀ WORKER KHÔNG DỰNG ĐƯỢC. Và không cổng nào bắt
    // được trừ `check:worker`:
    //
    //   npm test     xanh — spec tự `new TasksService(...)`, không qua bộ tiêm
    //   check:boot   xanh — AppModule có ProductsModule nên repository có sẵn ở
    //                 đó; chỉ WorkerModule là thiếu
    //
    // Đã hỏng thật từ 06/10 (commit 9882fba thêm @InjectRepository(Product) vào
    // TasksService mà không sửa file này) và không ai thấy tới 07/10, vì
    // `check:worker` chưa nằm trong `npm run nghiem-thu`. Hậu quả nếu deploy:
    // worker chết lúc khởi động → không huỷ đơn quá hạn, không chốt vận đơn,
    // không flush view_count.
    //
    // Đây đúng cái bẫy mà comment đầu `worker.module.ts` đã kể về task #14.
    TypeOrmModule.forFeature([Order, Product]),
    OrdersModule,
  ],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
