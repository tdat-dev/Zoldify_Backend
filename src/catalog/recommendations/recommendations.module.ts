import { Module } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import {
  MyRecommendationsController,
  RecommendationsController,
} from './recommendations.controller';

/**
 * Gợi ý sản phẩm (task #15).
 *
 * KHÔNG khai `TypeOrmModule.forFeature` nào: service chạy SQL thô qua
 * `DataSource` (đã là global từ `TypeOrmModule.forRootAsync`), không dùng
 * repository nào. Khai thêm entity ở đây chỉ để trông "đầy đủ" là thêm một
 * phụ thuộc không ai cần.
 */
@Module({
  controllers: [RecommendationsController, MyRecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
