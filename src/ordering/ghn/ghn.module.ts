import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GhnService } from './ghn.service';
import { GhnController } from './ghn.controller';
import { Order } from '@ordering/orders/entities/order.entity';

@Module({
  imports: [
    // B-19 (audit B-production-readiness.md): 30s cũ nhân với số người bán
    // trong đơn vì các lệnh tạo vận đơn chạy tuần tự — một seller chậm treo
    // cả request xác nhận. Giảm xuống 10s và đánh đổi bằng
    // `OrdersService.goiGhnVoiThuLai`: lỗi timeout (không có response) được
    // thử lại tối đa 2 lần, an toàn vì GHN chống trùng theo client_order_code.
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
    TypeOrmModule.forFeature([Order]),
  ],
  controllers: [GhnController],
  providers: [GhnService],
  exports: [GhnService],
})
export class GhnModule {}
