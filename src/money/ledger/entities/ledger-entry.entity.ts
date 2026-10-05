import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigintTransformer } from '../ledger.types';
import { LedgerAccount } from './ledger-account.entity';
import { LedgerTransaction } from './ledger-transaction.entity';

/**
 * Một dòng trong sổ cái. CHỈ THÊM, không bao giờ sửa hay xoá.
 *
 * Muốn đảo một giao dịch thì ghi giao dịch ngược lại, không sửa bản ghi
 * cũ — có vậy mới truy được lịch sử tiền đi đâu.
 *
 * `amount` âm là tiền ra, dương là tiền vào. Tổng amount của mọi dòng
 * trong cùng một transaction BẮT BUỘC bằng 0: tiền không sinh ra và không
 * mất đi, nó chỉ chuyển giữa các tài khoản.
 */
@Entity('ledger_entries')
@Index('idx_ledger_entry_account_time', ['account', 'created_at'])
export class LedgerEntry {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @ManyToOne(() => LedgerTransaction, (tx) => tx.entries, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'transaction_id' })
  transaction: LedgerTransaction;

  @ManyToOne(() => LedgerAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account: LedgerAccount;

  /** Đơn vị ĐỒNG. Âm = ra, dương = vào */
  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount: bigint;

  /** Số dư của tài khoản NGAY SAU dòng này — để dò lại lịch sử cho nhanh */
  @Column({ type: 'bigint', transformer: bigintTransformer })
  balance_after: bigint;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
