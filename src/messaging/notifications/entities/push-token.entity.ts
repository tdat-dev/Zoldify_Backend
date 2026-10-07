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

/**
 * Token thiết bị (FCM) để đẩy push. Một user có thể có nhiều thiết bị nên đây
 * là bảng riêng thay vì cột trên user. `token` UNIQUE để cùng thiết bị đăng ký
 * lại chỉ cập nhật (upsert) chứ không nhân bản.
 */
@Entity('push_tokens')
@Index('idx_push_user', ['user'])
export class PushToken {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 512, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 16, default: 'android' })
  platform: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
