import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Unique, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('follows')
@Unique(['follower_id', 'following_id'])
export class Follow {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  follower_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'follower_id' })
  follower: User;

  @Column()
  following_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'following_id' })
  following: User;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}