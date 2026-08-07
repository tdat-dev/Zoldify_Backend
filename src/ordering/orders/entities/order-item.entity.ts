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
import { Order } from './order.entity';
import { Product } from '@catalog/products/entities/product.entity';

@Entity('order_items')
@Index('idx_product_id', ['product'])
export class OrderItem {
  @PrimaryGeneratedColumn()
  id: number;

  // Đơn hàng thuộc về
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  // Sản phẩm
  @ManyToOne(() => Product, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  // Tên sản phẩm (lưu snapshot để không bị ảnh hưởng khi product đổi tên)
  @Column({ type: 'varchar', length: 255 })
  product_name: string;

  // Ảnh sản phẩm (lưu snapshot)
  @Column({ type: 'varchar', length: 255, nullable: true })
  product_image: string;

  // Giá tại thời điểm đặt hàng
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  price: number;

  // Số lượng
  @Column({ type: 'int', default: 1 })
  quantity: number;

  // Thành tiền (price * quantity)
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  subtotal: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
