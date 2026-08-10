import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Wallet } from './entities/wallet.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';

/**
 * Ví người dùng — giờ chỉ là lớp mỏng đọc/ghi qua sổ cái.
 *
 * Bản cũ giữ số dư ở BA nơi: `wallets.balance`, `users.balance` và
 * `wallet_transactions`. Ba nơi cập nhật rời rạc, không transaction, nên chỉ
 * cần một lần sập giữa chừng là chúng lệch nhau vĩnh viễn và không có cách
 * nào biết cái nào đúng. `transfer()` còn tệ hơn: nó gọi `deduct` rồi
 * `topup` như hai thao tác riêng, sập ở giữa là tiền bốc hơi khỏi hệ thống.
 *
 * Giờ nguồn sự thật duy nhất là `ledger_accounts` + `ledger_entries`.
 * Bảng `wallets` và `wallet_transactions` không còn được ghi.
 */
@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Giữ lại cho tương thích: vài nơi vẫn gọi để chắc chắn người dùng có ví.
   * Với sổ cái thì "ví" chính là tài khoản `user/available`.
   */
  async getOrCreateWallet(userId: number) {
    return this.ledger.getOrCreateAccount(
      LedgerOwnerType.USER,
      userId,
      LedgerPurpose.AVAILABLE,
    );
  }

  async getBalance(userId: number) {
    const available = await this.ledger.getBalance(
      LedgerOwnerType.USER,
      userId,
      LedgerPurpose.AVAILABLE,
    );
    return { balance: Number(available) };
  }

  /**
   * Số tiền đang bị giữ vì có lệnh rút đang chờ admin xử lý.
   * Tách riêng để giao diện hiển thị đúng "khả dụng" và "đang chờ".
   */
  async getPendingWithdrawal(userId: number) {
    const pending = await this.ledger.getBalance(
      LedgerOwnerType.USER,
      userId,
      LedgerPurpose.WITHDRAWAL_PENDING,
    );
    return Number(pending);
  }

  /**
   * Cộng tiền vào ví.
   *
   * `idempotencyKey` nên do người gọi truyền vào và phải tất định. Không
   * truyền thì hàm tự sinh một khoá ngẫu nhiên, tức lần gọi này KHÔNG chống
   * được lặp — bấm hai lần là cộng hai lần. Chấp nhận được với thao tác tay
   * của admin, KHÔNG chấp nhận được với webhook.
   */
  async topup(
    userId: number,
    amount: number,
    reference?: string,
    note?: string,
    idempotencyKey?: string,
  ) {
    this.assertPositive(amount);
    const gateway = await this.ledger.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
    );
    const wallet = await this.getOrCreateWallet(userId);

    await this.ledger.post({
      idempotencyKey: idempotencyKey ?? `wallet_topup:${randomUUID()}`,
      type: LedgerTxType.TOPUP,
      reference: reference ? { type: 'wallet', id: userId } : undefined,
      metadata: { reference, note },
      entries: [
        { accountId: Number(gateway.id), amount: -BigInt(Math.round(amount)) },
        { accountId: Number(wallet.id), amount: BigInt(Math.round(amount)) },
      ],
    });

    return this.getBalance(userId);
  }

  /**
   * Trừ tiền khỏi ví.
   *
   * Không cần tự kiểm số dư: `LedgerService.post()` từ chối mọi bút toán làm
   * tài khoản người dùng âm, và nó kiểm SAU khi đã khoá dòng nên hai request
   * song song không lách được. Bản cũ đọc số dư ra biến rồi mới trừ, hai
   * request cùng lúc đều thấy đủ tiền và cùng trừ thành công.
   */
  async deduct(
    userId: number,
    amount: number,
    reference?: string,
    note?: string,
    idempotencyKey?: string,
  ) {
    this.assertPositive(amount);
    const wallet = await this.getOrCreateWallet(userId);
    const hold = await this.ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

    await this.ledger.post({
      idempotencyKey: idempotencyKey ?? `wallet_deduct:${randomUUID()}`,
      type: LedgerTxType.ORDER_HOLD,
      metadata: { reference, note },
      entries: [
        { accountId: Number(wallet.id), amount: -BigInt(Math.round(amount)) },
        { accountId: Number(hold.id), amount: BigInt(Math.round(amount)) },
      ],
    });

    return this.getBalance(userId);
  }

  async refund(
    userId: number,
    amount: number,
    reference?: string,
    note?: string,
    idempotencyKey?: string,
  ) {
    this.assertPositive(amount);
    const wallet = await this.getOrCreateWallet(userId);
    const hold = await this.ledger.getOrCreateAccount(
      LedgerOwnerType.PLATFORM,
      null,
      LedgerPurpose.ESCROW_HOLD,
    );

    await this.ledger.post({
      idempotencyKey: idempotencyKey ?? `wallet_refund:${randomUUID()}`,
      type: LedgerTxType.ESCROW_REFUND,
      metadata: { reference, note },
      entries: [
        { accountId: Number(hold.id), amount: -BigInt(Math.round(amount)) },
        { accountId: Number(wallet.id), amount: BigInt(Math.round(amount)) },
      ],
    });

    return this.getBalance(userId);
  }

  /**
   * Chuyển tiền giữa hai ví, trong MỘT bút toán.
   *
   * Bản cũ gọi `deduct` rồi `topup` như hai thao tác riêng — sập ở giữa thì
   * người gửi mất tiền mà người nhận không có. Một giao dịch hai chân thì
   * không tồn tại khoảng giữa đó.
   */
  async transfer(
    fromUserId: number,
    toUserId: number,
    amount: number,
    note?: string,
    idempotencyKey?: string,
  ) {
    this.assertPositive(amount);
    if (fromUserId === toUserId) {
      throw new BadRequestException('Không thể chuyển tiền cho chính mình');
    }

    const from = await this.getOrCreateWallet(fromUserId);
    const to = await this.getOrCreateWallet(toUserId);

    await this.ledger.post({
      idempotencyKey: idempotencyKey ?? `wallet_transfer:${randomUUID()}`,
      type: LedgerTxType.ADJUSTMENT,
      metadata: { fromUserId, toUserId, note },
      entries: [
        { accountId: Number(from.id), amount: -BigInt(Math.round(amount)) },
        { accountId: Number(to.id), amount: BigInt(Math.round(amount)) },
      ],
    });

    return { message: 'Chuyển tiền thành công' };
  }

  /**
   * Lịch sử giao dịch, đọc thẳng từ sổ cái thay vì bảng
   * `wallet_transactions` cũ — bảng đó không còn được ghi nên sẽ đứng yên.
   */
  async getTransactions(
    userId: number,
    page: number,
    limit: number,
    type?: string,
    manager?: EntityManager,
  ) {
    const em = manager ?? this.dataSource.manager;
    const account = await this.getOrCreateWallet(userId);

    const where = type ? 'e.account_id = ? AND t.type = ?' : 'e.account_id = ?';
    const params = type ? [account.id, type] : [account.id];

    const [{ total }] = await em.query(
      `SELECT COUNT(*) AS total FROM ledger_entries e
       JOIN ledger_transactions t ON t.id = e.transaction_id
       WHERE ${where}`,
      params,
    );

    const rows = await em.query(
      `SELECT e.id, e.amount, e.balance_after, e.created_at,
              t.type, t.reference_type, t.reference_id, t.metadata
       FROM ledger_entries e
       JOIN ledger_transactions t ON t.id = e.transaction_id
       WHERE ${where}
       ORDER BY e.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(Number(total) / limit),
        total: Number(total),
      },
      result: rows.map((r: any) => ({
        id: Number(r.id),
        amount: Number(r.amount),
        balance_after: Number(r.balance_after),
        type: r.type,
        reference_type: r.reference_type,
        reference_id: r.reference_id ? Number(r.reference_id) : null,
        note: r.metadata?.note ?? null,
        created_at: r.created_at,
      })),
    };
  }

  private assertPositive(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    }
  }
}
