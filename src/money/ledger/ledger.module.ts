import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerAccount } from './entities/ledger-account.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerTransaction } from './entities/ledger-transaction.entity';
import { LedgerService } from './ledger.service';
import { PlatformFeeService } from './platform-fee.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LedgerAccount, LedgerTransaction, LedgerEntry]),
  ],
  providers: [LedgerService, PlatformFeeService],
  exports: [LedgerService, PlatformFeeService],
})
export class LedgerModule {}
