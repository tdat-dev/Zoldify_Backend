import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { UpdateWithdrawalDto } from './dto/update-withdrawal.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectRepository(Withdrawal)
    private withdrawalRepository: Repository<Withdrawal>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) { }

  async create(
    userId: number,
    dto: {
      amount: number;
      bank_name: string;
      bank_account: string;
      bank_holder: string;

    }
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const balance = Number(user.balance);
    if (balance < dto.amount) {
      throw new BadRequestException(
        `Số dư không đủ. Cần ${dto.amount.toLocaleString()}đ, hiện có ${balance.toLocaleString()}đ`,
      );
    }

    // Trừ tiền ngay khi tạo yêu cầu
    await this.userRepository.update(userId, { balance: balance - dto.amount });

    const withdrawal = this.withdrawalRepository.create({
      user: { id: userId },
      amount: dto.amount,
      bank_name: dto.bank_name,
      bank_account: dto.bank_account,
      bank_holder: dto.bank_holder,
      status: WithdrawalStatus.PENDING,
    });

    return this.withdrawalRepository.save(withdrawal);
  }

  async findByUser(userId: number, page: number, limit: number) {
    const [result, total] = await this.withdrawalRepository.findAndCount({
      where: { user: { id: userId } },
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

  async findAll(page: number, limit: number, status?: string) {
    const where: any = {};
    if (status) where.status = status;

    const [result, total] = await this.withdrawalRepository.findAndCount({
      where,
      relations: ['user', 'approved_by'],
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

  async approve(id: number, adminId: number) {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!withdrawal) throw new NotFoundException('Không tìm thấy yêu cầu rút tiền');
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Yêu cầu đã được xử lý');
    }

    withdrawal.status = WithdrawalStatus.APPROVED;
    withdrawal.approved_by = { id: adminId } as any;
    withdrawal.processed_at = new Date();
    return this.withdrawalRepository.save(withdrawal);
  }

  async reject(id: number, adminId: number, note?: string) {
    const withdrawal = await this.withdrawalRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!withdrawal) throw new NotFoundException('Không tìm thấy yêu cầu rút tiền');
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Yêu cầu đã được xử lý');
    }

    // Hoàn lại tiền cho user
    await this.userRepository.increment(
      { id: withdrawal.user.id },
      'balance',
      Number(withdrawal.amount),
    );

    withdrawal.status = WithdrawalStatus.REJECTED;
    withdrawal.note = note || '';
    withdrawal.approved_by = { id: adminId } as any;
    withdrawal.processed_at = new Date();
    return this.withdrawalRepository.save(withdrawal);
  }
}
