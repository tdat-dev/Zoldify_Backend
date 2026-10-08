import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '@identity/users/entities/user.entity';

export enum WithdrawalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
}

@Entity('withdrawals')
@Index('idx_user', ['user'])
@Index('idx_status', ['status'])
// Index ghép cho danh sách "của tôi, mới nhất trước" — do migration
// AddListOrderingIndexes/Round2 tạo. Khai lại ở đây vì entity mới là nguồn mà
// `migration:generate` và `synchronize` đọc: thiếu dòng này thì lần sinh
// migration tới sẽ đề nghị XOÁ index đang phục vụ production.
@Index('idx_user_created', ['user', 'created_at'])
export class Withdrawal {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 100 })
  bank_name: string;

  @Column({ type: 'varchar', length: 50 })
  bank_account: string;

  @Column({ type: 'varchar', length: 100 })
  bank_holder: string;

  @Column({
    type: 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.PENDING,
  })
  status: WithdrawalStatus;

  @Column({ type: 'text', nullable: true })
  note: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approved_by: User;

  @Column({ type: 'datetime', nullable: true })
  processed_at: Date;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
