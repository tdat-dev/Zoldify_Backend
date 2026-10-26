import { Module } from '@nestjs/common';
import { TasksModule } from '@ops/tasks/tasks.module';
import { ProductsModule } from '@catalog/products/products.module';
import { JobsRunner } from './jobs.runner';

/**
 * Hàng đợi job nền.
 *
 * Module này CHỈ được `WorkerModule` nạp, không bao giờ được `AppModule` nạp.
 * Đó chính là ranh giới mà task #14 dựng lên: nạp nó vào API là mỗi bản api
 * lại thành một worker, và bài toán "cron tiền chạy N lần" quay lại nguyên vẹn.
 *
 * scripts/selfcheck-worker.ts canh điều này bằng cách đọc app.module.ts và
 * FAIL nếu thấy chữ JobsModule trong đó.
 */
@Module({
  // ProductsModule: worker xử lý job "báo hàng mới" bằng ProductsService.
  imports: [TasksModule, ProductsModule],
  providers: [JobsRunner],
})
export class JobsModule {}
