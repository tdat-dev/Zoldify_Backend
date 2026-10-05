import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { Wallet } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { User } from '@identity/users/entities/user.entity';
import { LedgerModule } from '@money/ledger/ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletTransaction, User]),
    LedgerModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule { }