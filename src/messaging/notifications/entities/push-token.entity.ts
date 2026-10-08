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
 *
 * Tên index/FK và precision khai RÕ ở đây để khớp đúng
 * `1787670000000-CreatePushTokens.ts` — thiếu khai thì TypeORM tự đặt tên băm
 * (`IDX_869b...`, `FK_94c3...`) và mặc định `timestamp(6)`, lệch với bảng migration
 * thật đã tạo (`uq_push_token`, `fk_push_user`, `timestamp` không precision).
 * `check:drift` (ngưỡng 0) bắt đúng 7 dòng lệch này.
 */
@Entity('push_tokens')
@Index('idx_push_user', ['user'])
@Index('uq_push_token', ['token'], { unique: true })
export class PushToken {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_push_user' })
  user: User;

  @Column({ type: 'varchar', length: 512 })
  token: string;

  @Column({ type: 'varchar', length: 16, default: 'android' })
  platform: string;

  // `default`/`onUpdate` phải tự khai CURRENT_TIMESTAMP KHÔNG precision: mặc
  // định của TypeORM (createDateDefault) luôn là CURRENT_TIMESTAMP(6) bất kể
  // cột khai precision gì, nên chỉ đặt `precision: 0` là không đủ — vẫn lệch.
  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
