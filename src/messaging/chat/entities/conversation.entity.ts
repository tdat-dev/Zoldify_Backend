import {
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { Product } from '@catalog/products/entities/product.entity';

@Entity('conversations')
@Index('idx_buyer_seller_product', ['buyer', 'seller', 'product'], {
  unique: true,
})
// Index ghép cho danh sách "của tôi, mới nhất trước" — do migration
// AddListOrderingIndexes/Round2 tạo. Khai lại ở đây vì entity mới là nguồn mà
// `migration:generate` và `synchronize` đọc: thiếu dòng này thì lần sinh
// migration tới sẽ đề nghị XOÁ index đang phục vụ production.
@Index('idx_buyer_updated', ['buyer', 'updated_at'])
@Index('idx_seller_updated', ['seller', 'updated_at'])
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @ManyToOne(() => Product, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
