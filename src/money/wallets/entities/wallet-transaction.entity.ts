import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Wallet } from './wallet.entity';

export enum TransactionType {
  TOPUP = 'topup',
  PAYMENT = 'payment',
  REFUND = 'refund',
  WITHDRAWAL = 'withdrawal',
}

@Entity('wallet_transactions')
@Index('idx_wallet', ['wallet'])
// Index ghép cho danh sách "của tôi, mới nhất trước" — do migration
// AddListOrderingIndexes/Round2 tạo. Khai lại ở đây vì entity mới là nguồn mà
// `migration:generate` và `synchronize` đọc: thiếu dòng này thì lần sinh
// migration tới sẽ đề nghị XOÁ index đang phục vụ production.
@Index('idx_wallet_created', ['wallet', 'created_at'])
export class WalletTransaction {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  balance_before: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  balance_after: number;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
