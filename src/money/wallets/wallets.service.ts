import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { TransactionType, WalletTransaction } from './entities/wallet-transaction.entity';
import { User } from '@identity/users/entities/user.entity';
import { Repository } from 'typeorm';


@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(WalletTransaction)
    private readonly transactionRepository: Repository<WalletTransaction>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }
  async getOrCreateWallet(userId: number) {
    let wallet = await this.walletRepository.findOne({
      where: { user: { id: userId } },
      relations: ['user'],
    });

    if (!wallet) {
      wallet = this.walletRepository.create({
        user: { id: userId },
        balance: 0,
      });
      wallet = await this.walletRepository.save(wallet);
    }

    return wallet;
  }

  async getBalance(userId: number) {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: Number(wallet.balance) };
  }

  async topup(
    userId: number,
    amount: number,
    reference?: string,
    note?: string,
  ) {
    const wallet = await this.getOrCreateWallet(userId);
    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore + amount;

    wallet.balance = balanceAfter;
    await this.walletRepository.save(wallet);

    // Đồng bộ User.balance
    await this.userRepository.update(userId, { balance: balanceAfter });

    const transaction = this.transactionRepository.create({
      wallet: { id: wallet.id },
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      type: TransactionType.TOPUP,
      reference,
      note,
    });
    await this.transactionRepository.save(transaction);

    return { balance: balanceAfter, transaction };
  }

  async deduct(
    userId: number,
    amount: number,
    reference?: string,
    note?: string,
  ) {
    const wallet = await this.getOrCreateWallet(userId);
    const balanceBefore = Number(wallet.balance);

    if (balanceBefore < amount) {
      throw new BadRequestException(
        `Số dư không đủ. Cần ${amount.toLocaleString()}đ, hiện có ${balanceBefore.toLocaleString()}đ`,
      );
    }

    const balanceAfter = balanceBefore - amount;
    wallet.balance = balanceAfter;
    await this.walletRepository.save(wallet);

    // Đồng bộ User.balance
    await this.userRepository.update(userId, { balance: balanceAfter });

    const transaction = this.transactionRepository.create({
      wallet: { id: wallet.id },
      amount: -amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      type: TransactionType.PAYMENT,
      reference,
      note,
    });
    await this.transactionRepository.save(transaction);

    return { balance: balanceAfter, transaction };
  }

  async refund(
    userId: number,
    amount: number,
    reference?: string,
    note?: string,
  ) {
    const wallet = await this.getOrCreateWallet(userId);
    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore + amount;

    wallet.balance = balanceAfter;
    await this.walletRepository.save(wallet);

    await this.userRepository.update(userId, { balance: balanceAfter });

    const transaction = this.transactionRepository.create({
      wallet: { id: wallet.id },
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      type: TransactionType.REFUND,
      reference,
      note,
    });
    await this.transactionRepository.save(transaction);

    return { balance: balanceAfter, transaction };
  }

  async transfer(
    fromUserId: number,
    toUserId: number,
    amount: number,
    note?: string,
  ) {
    await this.deduct(fromUserId, amount, 'transfer', note);
    await this.topup(toUserId, amount, 'transfer', note);
    return { message: 'Chuyển tiền thành công' };
  }

  async getTransactions(
    userId: number,
    page: number,
    limit: number,
    type?: string,
  ) {
    const wallet = await this.getOrCreateWallet(userId);

    const where: any = { wallet: { id: wallet.id } };
    if (type) where.type = type;

    const [result, total] = await this.transactionRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result,
    };
  }
}
