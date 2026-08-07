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
import { Order } from '@ordering/orders/entities/order.entity';
import { PaymentMethod, PaymentStatus, PaymentType } from '@common/enums/payment.enum';

@Entity('payments')
@Index('idx_user_id', ['user'])
@Index('idx_order_id', ['order'])
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Order, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
  })
  payment_method: PaymentMethod;

  @Column({ type: 'varchar', length: 100, nullable: true })
  transaction_code: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({
    type: 'enum',
    enum: PaymentType,
  })
  type: PaymentType;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ type: 'datetime', nullable: true })
  paid_at: Date;

  // ============ PayOS fields ============
  @Index('idx_payos_order_code', { unique: false })
  @Column({ type: 'varchar', length: 50, nullable: true })
  payos_order_code: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  payos_payment_link_id: string;

  @Column({ type: 'text', nullable: true })
  payos_checkout_url: string;

  @Column({ type: 'text', nullable: true })
  payos_qr_code: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
