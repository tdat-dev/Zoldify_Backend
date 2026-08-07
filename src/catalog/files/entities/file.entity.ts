import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';

@Entity('files')
export class FileEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ type: 'varchar', length: 50 })
  mime_type: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'varchar', length: 50, default: 'default' })
  folder: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uploaded_by' })
  uploaded_by: User;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}