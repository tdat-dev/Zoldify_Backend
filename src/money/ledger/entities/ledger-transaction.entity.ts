import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LedgerTxType } from '../ledger.types';
import { LedgerEntry } from './ledger-entry.entity';

/**
 * Một sự kiện tiền, gom nhiều bút toán lại.
 *
 * `idempotency_key` là lá chắn chống xử lý trùng, và nó UNIQUE ở tầng
 * DATABASE chứ không phải ở tầng code — code có thể quên kiểm, database
 * thì không. Vì bản ghi này được INSERT trong CÙNG transaction với việc
 * cộng tiền, hai việc chung một số phận: hoặc cả hai xảy ra, hoặc không
 * cái nào. Đó là chỗ khác biệt với bảng payos_webhook_log cũ, nơi log
 * được ghi TRƯỚC và ngoài transaction nên sập giữa chừng là mất tiền.
 */
@Entity('ledger_transactions')
@Index('idx_ledger_tx_ref', ['reference_type', 'reference_id'])
export class LedgerTransaction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'enum', enum: LedgerTxType })
  type: LedgerTxType;

  /**
   * Khoá tất định, KHÔNG random. Ví dụ:
   *   payos:{orderCode}:{paymentLinkId}
   *   escrow_release:{escrowId}
   * Gọi lại bao nhiêu lần cũng chỉ có hiệu lực một lần.
   *
   * 191 ký tự để vừa giới hạn index của utf8mb4 trên MySQL cũ.
   */
  @Column({ type: 'varchar', length: 191, unique: true })
  idempotency_key: string;

  /**
   * Trỏ ngược về nghiệp vụ sinh ra giao dịch. Chỉ là chuỗi tự do — sổ cái
   * KHÔNG biết "đơn hàng" là gì, nhờ vậy money không phụ thuộc ordering.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  reference_type: string | null;

  @Column({ type: 'bigint', nullable: true })
  reference_id: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @OneToMany(() => LedgerEntry, (entry) => entry.transaction)
  entries: LedgerEntry[];
}
