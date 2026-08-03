import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('payos_webhook_logs')
export class PayosWebhookLog {
  @PrimaryGeneratedColumn()
  id: number;

  // UNIQUE để chống trùng lặp (mỗi payment link chỉ xử lý 1 lần)
  @Index('idx_transaction_id', { unique: true })
  @Column({ type: 'varchar', length: 100 })
  transaction_id: string;

  @Column({ type: 'json' })
  body: any;

  @Column({ type: 'boolean', default: false })
  processed: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
