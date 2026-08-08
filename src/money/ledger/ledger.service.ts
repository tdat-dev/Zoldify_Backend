import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  IsNull,
  QueryFailedError,
} from 'typeorm';
import { LedgerAccount } from './entities/ledger-account.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { LedgerTransaction } from './entities/ledger-transaction.entity';
import { LedgerOwnerType, LedgerPurpose, LedgerTxType } from './ledger.types';

/** Mã lỗi MySQL khi đụng ràng buộc UNIQUE */
const ER_DUP_ENTRY = 1062;

export interface LedgerEntryInput {
  accountId: number;
  /** Đơn vị ĐỒNG. Âm = ra khỏi tài khoản, dương = vào */
  amount: bigint;
}

export interface PostLedgerTxInput {
  /** BẮT BUỘC, tất định, không random. Ví dụ escrow_release:42 */
  idempotencyKey: string;
  type: LedgerTxType;
  /** Ít nhất 2 dòng, tổng amount phải bằng 0 */
  entries: LedgerEntryInput[];
  reference?: { type: string; id: number };
  metadata?: Record<string, unknown>;
}

/**
 * Cửa DUY NHẤT được phép làm số dư thay đổi.
 *
 * Không module nào được tự UPDATE ledger_accounts.balance hay tự cộng vào
 * users.balance. Luật ranh giới trong eslint.config.mjs chặn money với
 * sang ordering/catalog, còn luật này thì chặn ngay trong nội bộ money:
 * tiền chỉ chạy qua post().
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Lấy tài khoản, chưa có thì tạo.
   *
   * Hai request đồng thời cùng tạo một tài khoản sẽ có một cái đụng UNIQUE;
   * bắt lỗi đó rồi đọc lại, không để lộ ra ngoài.
   */
  async getOrCreateAccount(
    ownerType: LedgerOwnerType,
    ownerId: number | null,
    purpose: LedgerPurpose,
    manager?: EntityManager,
  ): Promise<LedgerAccount> {
    const em = manager ?? this.dataSource.manager;

    // Tìm và tạo cần hai dạng khác nhau: TypeORM đòi IsNull() khi tìm cột
    // nullable, nhưng lúc tạo thì phải là null thật.
    const where = this.accountWhere(ownerType, ownerId, purpose);
    const createData = {
      owner_type: ownerType,
      owner_id: ownerId === null ? null : String(ownerId),
      purpose,
      // Khai rõ 0 thay vì trông chờ DEFAULT của cột — tài khoản mới luôn
      // bắt đầu từ không đồng, đừng để chuyện đó phụ thuộc lược đồ.
      balance: 0n,
    };

    const existing = await em.findOne(LedgerAccount, { where });
    if (existing) return existing;

    try {
      return await em.save(LedgerAccount, em.create(LedgerAccount, createData));
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        const raced = await em.findOne(LedgerAccount, { where });
        if (raced) return raced;
      }
      throw err;
    }
  }

  private accountWhere(
    ownerType: LedgerOwnerType,
    ownerId: number | null,
    purpose: LedgerPurpose,
  ): FindOptionsWhere<LedgerAccount> {
    return {
      owner_type: ownerType,
      owner_id: ownerId === null ? IsNull() : String(ownerId),
      purpose,
    };
  }

  /**
   * Ghi một giao dịch vào sổ cái.
   *
   * Toàn bộ nằm trong MỘT transaction database:
   *  1. INSERT ledger_transactions — idempotency_key UNIQUE. Trùng thì
   *     MySQL ném lỗi, ta rollback rồi trả về giao dịch cũ. Nhờ vậy bản
   *     ghi chống trùng và việc cộng tiền chung một số phận.
   *  2. Khoá các tài khoản bằng SELECT ... FOR UPDATE, sắp xếp theo id
   *     TĂNG DẦN. Thứ tự cố định là thứ chống deadlock chéo: hai giao
   *     dịch đụng cùng hai tài khoản sẽ xin khoá theo cùng một thứ tự.
   *  3. Kiểm tổng bằng 0 và không tài khoản người dùng nào âm.
   *  4. INSERT entries + UPDATE balance.
   */
  async post(input: PostLedgerTxInput): Promise<LedgerTransaction> {
    this.validateInput(input);

    try {
      return await this.dataSource.transaction(async (em) => {
        const tx = await em.save(
          LedgerTransaction,
          em.create(LedgerTransaction, {
            type: input.type,
            idempotency_key: input.idempotencyKey,
            reference_type: input.reference?.type ?? null,
            reference_id: input.reference ? String(input.reference.id) : null,
            metadata: input.metadata ?? null,
          }),
        );

        const accounts = await this.lockAccounts(
          em,
          input.entries.map((e) => e.accountId),
        );

        for (const entry of input.entries) {
          const account = accounts.get(entry.accountId);
          if (!account) {
            throw new BadRequestException(
              `Không tìm thấy tài khoản sổ cái id=${entry.accountId}`,
            );
          }

          const balanceAfter = account.balance + entry.amount;

          // Tài khoản của người dùng không được âm. Tài khoản hệ thống
          // (platform, external) thì được — gateway_clearing âm dần chính
          // là số tiền đã chảy vào từ cổng thanh toán.
          if (
            account.owner_type === LedgerOwnerType.USER &&
            balanceAfter < 0n
          ) {
            throw new BadRequestException(
              `Số dư không đủ. Cần ${(-entry.amount).toString()}đ, ` +
                `hiện có ${account.balance.toString()}đ`,
            );
          }

          await em.save(
            LedgerEntry,
            em.create(LedgerEntry, {
              transaction: tx,
              account,
              amount: entry.amount,
              balance_after: balanceAfter,
            }),
          );

          account.balance = balanceAfter;
          await em.save(LedgerAccount, account);
        }

        return tx;
      });
    } catch (err) {
      if (this.isDuplicateKey(err)) {
        // Đã xử lý trước đó rồi. Đây là đường đi BÌNH THƯỜNG khi PayOS
        // gửi lại webhook hoặc người dùng bấm hai lần, không phải lỗi.
        const existing = await this.dataSource.manager.findOne(
          LedgerTransaction,
          { where: { idempotency_key: input.idempotencyKey } },
        );
        if (existing) {
          this.logger.log(`Bỏ qua giao dịch trùng: ${input.idempotencyKey}`);
          return existing;
        }
      }
      throw err;
    }
  }

  /** Số dư hiện tại. Chưa có tài khoản nghĩa là chưa có đồng nào. */
  async getBalance(
    ownerType: LedgerOwnerType,
    ownerId: number | null,
    purpose: LedgerPurpose,
  ): Promise<bigint> {
    const account = await this.dataSource.manager.findOne(LedgerAccount, {
      where: this.accountWhere(ownerType, ownerId, purpose),
    });
    return account?.balance ?? 0n;
  }

  private validateInput(input: PostLedgerTxInput): void {
    if (!input.idempotencyKey) {
      throw new BadRequestException('Giao dịch sổ cái phải có idempotencyKey');
    }

    if (!input.entries || input.entries.length < 2) {
      throw new BadRequestException(
        'Giao dịch sổ cái phải có ít nhất 2 bút toán — tiền phải đi từ đâu đó tới đâu đó',
      );
    }

    const ids = input.entries.map((e) => e.accountId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Một tài khoản chỉ được xuất hiện một lần trong cùng giao dịch',
      );
    }

    const sum = input.entries.reduce((acc, e) => acc + e.amount, 0n);
    if (sum !== 0n) {
      throw new BadRequestException(
        `Tổng bút toán phải bằng 0, đang lệch ${sum.toString()}. ` +
          'Tiền không sinh ra và không mất đi.',
      );
    }
  }

  /**
   * Khoá các tài khoản theo thứ tự id tăng dần.
   * Thứ tự cố định là thứ ngăn deadlock khi hai giao dịch đụng cùng một
   * cặp tài khoản theo chiều ngược nhau.
   */
  private async lockAccounts(
    em: EntityManager,
    accountIds: number[],
  ): Promise<Map<number, LedgerAccount>> {
    const sorted = [...new Set(accountIds)].sort((a, b) => a - b);

    const accounts = await em
      .createQueryBuilder(LedgerAccount, 'account')
      .setLock('pessimistic_write')
      .where('account.id IN (:...ids)', { ids: sorted })
      .orderBy('account.id', 'ASC')
      .getMany();

    return new Map(accounts.map((a) => [Number(a.id), a]));
  }

  private isDuplicateKey(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const driverError = err.driverError as { errno?: number } | undefined;
    return driverError?.errno === ER_DUP_ENTRY;
  }
}
