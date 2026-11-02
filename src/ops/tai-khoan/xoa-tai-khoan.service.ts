import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ProductsService } from '@catalog/products/products.service';
import { LedgerService } from '@money/ledger/ledger.service';

@Injectable()
export class XoaTaiKhoanService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly productsService: ProductsService,
    private readonly ledger: LedgerService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  xoaTaiKhoan(userId: number, password?: string): Promise<{ message: string }> {
    return Promise.reject(new NotImplementedException());
  }
}
