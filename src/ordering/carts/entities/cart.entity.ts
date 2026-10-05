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
import { Product } from '@catalog/products/entities/product.entity';

@Entity('carts')
// Ràng buộc duy nhất: Một user chỉ có 1 dòng cho 1 sản phẩm (nếu thêm nữa thì sẽ cộng dồn quantity)
@Index('unique_user_product', ['user', 'product'], { unique: true })
export class Cart {
  @PrimaryGeneratedColumn()
  id: number;

  // Khóa ngoại liên kết với User
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Khóa ngoại liên kết với Product
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  // Số lượng sản phẩm
  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn({ type: 'timestamp', nullable: true })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;
}
