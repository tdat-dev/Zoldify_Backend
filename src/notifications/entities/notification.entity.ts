import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum NotificationType {
  ORDER_STATUS = 'order_status',
  REVIEW = 'review',
  PAYMENT = 'payment',
  SYSTEM = 'system',
  MESSAGE = 'message',
  NEW_PRODUCT = 'new_product',
}

@Entity('notifications')
@Index('idx_user_read', ['user', 'is_read'])
@Index('idx_created_at', ['created_at'])
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'json', nullable: true })
  data: any;

  @Column({ type: 'tinyint', width: 1, default: 0 })
  is_read: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
