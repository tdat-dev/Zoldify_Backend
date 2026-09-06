import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// Không `imports` gì: `DataSource` do TypeOrmModule.forRoot cung cấp toàn cục,
// còn `CACHE_MANAGER` do CacheModule đăng ký với `isGlobal: true`.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
