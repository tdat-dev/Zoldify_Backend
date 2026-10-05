import { Module } from '@nestjs/common';
import { WithdrawalsService } from './withdrawals.service';
import { WithdrawalsController } from './withdrawals.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Withdrawal } from './entities/withdrawal.entity';
import { User } from '@identity/users/entities/user.entity';
import { LedgerModule } from '@money/ledger/ledger.module';


@Module({
  imports: [TypeOrmModule.forFeature([Withdrawal, User]), LedgerModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule { }
