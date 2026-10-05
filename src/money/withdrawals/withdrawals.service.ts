import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Withdrawal, WithdrawalStatus } from './entities/withdrawal.entity';
import { User } from '@identity/users/entities/user.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';

/**
 * Rút tiền, ba chặng.
 *
 * Tiền bị GIỮ ngay lúc gửi yêu cầu chứ không đợi admin duyệt. Nếu đợi thì
 * người bán gửi năm yêu cầu cùng lúc, mỗi cái bằng toàn bộ số dư, và cả năm
 * đều qua được bước kiểm.
 *
 *   gửi yêu cầu   available          -> withdrawal_pending
 *   admin từ chối withdrawal_pending -> available
 *   admin đã chuyển khoản
 *                 withdrawal_pending -> bank_external
 *
 * Khoảng giữa chặng hai và ba là lúc admin đang ngồi thao tác ở app ngân
 * hàng. Có tài khoản riêng cho khoảng đó thì lúc đối soát mới trả lời được
 * "phần chênh giữa sổ và số dư ngân hàng nằm ở đâu".
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    @InjectRepository(Withdrawal)
    private withdrawalRepository: Repository<Withdrawal>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  private pendingAccount(userId: number, em: EntityManager) {
    return this.ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      userId,
      LedgerPurpose.WITHDRAWAL_PENDING,
      em,
    );
  }

  private availableAccount(userId: number, em: EntityManager) {
    return this.ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      userId,
      LedgerPurpose.AVAILABLE,
      em,
    );
  }

  async create(
    userId: number,
    dto: {
      amount: number;
      bank_name: string;
      bank_account: string;
      bank_holder: string;
    },
  ) {
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('Số tiền rút phải lớn hơn 0');
    }

    return this.dataSource.transaction(async (em) => {
      const user = await em.findOne(User, { where: { id: userId } });
      if (!user) throw new NotFoundException('Không tìm thấy người dùng');

      // Lưu bản ghi TRƯỚC để có id làm khoá chống trùng cho bút toán.
      // Cùng transaction nên nếu bút toán hỏng thì bản ghi cũng biến mất.
      const withdrawal = await em.save(
        Withdrawal,
        em.create(Withdrawal, {
          user: { id: userId },
          amount: dto.amount,
          bank_name: dto.bank_name,
          bank_account: dto.bank_account,
          bank_holder: dto.bank_holder,
          status: WithdrawalStatus.PENDING,
        }),
      );

      const available = await this.availableAccount(userId, em);
      const pending = await this.pendingAccount(userId, em);
      const amount = BigInt(Math.round(dto.amount));

      // Không cần tự kiểm số dư: post() từ chối bút toán làm tài khoản người
      // dùng âm, và nó kiểm sau khi đã khoá dòng nên hai yêu cầu song song
      // không cùng lọt được.
      await this.ledger.post(
        {
          idempotencyKey: `withdrawal_request:${withdrawal.id}`,
          type: LedgerTxType.WITHDRAWAL_APPROVE,
          reference: { type: 'withdrawal', id: withdrawal.id },
          entries: [
            { accountId: Number(available.id), amount: -amount },
            { accountId: Number(pending.id), amount },
          ],
        },
        em,
      );

      return withdrawal;
    });
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

  /**
   * Admin duyệt. KHÔNG đụng tiền — tiền đã bị giữ từ lúc gửi yêu cầu.
   * Bước này chỉ nói "được, tôi sẽ chuyển khoản".
   */
  async approve(id: number, adminId: number) {
    const withdrawal = await this.loadPending(id);
    withdrawal.status = WithdrawalStatus.APPROVED;
    withdrawal.approved_by = { id: adminId } as any;
    withdrawal.processed_at = new Date();
    return this.withdrawalRepository.save(withdrawal);
  }

  /** Admin từ chối — trả tiền về ví người dùng. */
  async reject(id: number, adminId: number, note?: string) {
    return this.dataSource.transaction(async (em) => {
      const withdrawal = await this.loadPending(id, em);
      const userId = withdrawal.user.id;
      const amount = BigInt(Math.round(Number(withdrawal.amount)));

      const available = await this.availableAccount(userId, em);
      const pending = await this.pendingAccount(userId, em);

      await this.ledger.post(
        {
          idempotencyKey: `withdrawal_reject:${withdrawal.id}`,
          type: LedgerTxType.ADJUSTMENT,
          reference: { type: 'withdrawal', id: withdrawal.id },
          metadata: { note },
          entries: [
            { accountId: Number(pending.id), amount: -amount },
            { accountId: Number(available.id), amount },
          ],
        },
        em,
      );

      withdrawal.status = WithdrawalStatus.REJECTED;
      withdrawal.note = note || '';
      withdrawal.approved_by = { id: adminId } as any;
      withdrawal.processed_at = new Date();
      return em.save(Withdrawal, withdrawal);
    });
  }

  /**
   * Admin xác nhận đã chuyển khoản xong. Đây là lúc tiền thật sự rời khỏi
   * hệ thống.
   *
   * Bản cũ KHÔNG có bước này: lệnh rút dừng ở `approved` và tiền nằm lại mãi
   * trong sổ, không bao giờ khớp với số dư ngân hàng thật.
   */
  async complete(id: number, adminId: number) {
    return this.dataSource.transaction(async (em) => {
      const withdrawal = await em.findOne(Withdrawal, {
        where: { id },
        relations: ['user'],
      });
      if (!withdrawal) {
        throw new NotFoundException('Không tìm thấy yêu cầu rút tiền');
      }
      if (withdrawal.status !== WithdrawalStatus.APPROVED) {
        throw new BadRequestException(
          'Chỉ đánh dấu hoàn tất được yêu cầu đã duyệt',
        );
      }

      const amount = BigInt(Math.round(Number(withdrawal.amount)));
      const pending = await this.pendingAccount(withdrawal.user.id, em);
      const bank = await this.ledger.getOrCreateAccount(
        LedgerOwnerType.EXTERNAL,
        null,
        LedgerPurpose.BANK_EXTERNAL,
        em,
      );

      await this.ledger.post(
        {
          idempotencyKey: `withdrawal_complete:${withdrawal.id}`,
          type: LedgerTxType.WITHDRAWAL_COMPLETE,
          reference: { type: 'withdrawal', id: withdrawal.id },
          entries: [
            { accountId: Number(pending.id), amount: -amount },
            { accountId: Number(bank.id), amount },
          ],
        },
        em,
      );

      withdrawal.status = WithdrawalStatus.COMPLETED;
      withdrawal.approved_by = { id: adminId } as any;
      withdrawal.processed_at = new Date();
      return em.save(Withdrawal, withdrawal);
    });
  }

  private async loadPending(id: number, manager?: EntityManager) {
    const em = manager ?? this.dataSource.manager;
    const withdrawal = await em.findOne(Withdrawal, {
      where: { id },
      relations: ['user'],
    });
    if (!withdrawal) {
      throw new NotFoundException('Không tìm thấy yêu cầu rút tiền');
    }
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Yêu cầu đã được xử lý');
    }
    return withdrawal;
  }
}
