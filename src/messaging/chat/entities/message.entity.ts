import {
  Entity,
  Index,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { User } from '@identity/users/entities/user.entity';

@Entity('messages')
// idx_conversation_id (1 cột) ĐÃ BỎ: thừa vì idx_conversation_created
// (conversation_id, created_at) phủ leftmost prefix + đỡ luôn FK conversation_id.
// Xem migration 1787200000000.
//
// Nhưng chính idx_conversation_created thì trước nay CHƯA được khai ở đây —
// nó chỉ tồn tại trong migration. Entity mới là nguồn mà `migration:generate`
// và `synchronize` đọc, nên thiếu dòng dưới thì lần sinh migration tới sẽ đề
// nghị XOÁ đúng cái index đang phục vụ màn chat.
@Index('idx_conversation_created', ['conversation', 'created_at'])
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'json', nullable: true })
  images: string[];

  @Column({ type: 'boolean', default: false })
  is_read: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
