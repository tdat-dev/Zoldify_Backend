import { Module } from '@nestjs/common';
import { ProductsModule } from '@catalog/products/products.module';
import { LedgerModule } from '@money/ledger/ledger.module';
import { XoaTaiKhoanController } from './xoa-tai-khoan.controller';
import { XoaTaiKhoanService } from './xoa-tai-khoan.service';

@Module({
  // ProductsModule: ẩn hàng (có xoá cache danh sách). LedgerModule: số dư ví.
  imports: [ProductsModule, LedgerModule],
  controllers: [XoaTaiKhoanController],
  providers: [XoaTaiKhoanService],
})
export class TaiKhoanModule {}
