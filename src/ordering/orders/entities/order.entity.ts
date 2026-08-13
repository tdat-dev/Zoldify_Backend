import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { OrderItem } from './order-item.entity';
import { PaymentMethod } from '@common/enums/payment.enum';

export enum OrderStatus {
  PENDING = 'pending', // Chờ xác nhận
  CONFIRMED = 'confirmed', // Đã xác nhận
  PROCESSING = 'processing', // Đang xử lý
  SHIPPING = 'shipping', // Đang giao hàng
  DELIVERED = 'delivered', // Đã giao hàng
  CANCELLED = 'cancelled', // Đã hủy
  REFUNDED = 'refunded', // Đã hoàn tiền
}

@Entity('orders')
@Index('idx_created_at', ['created_at'])
@Index('idx_user_status', ['user', 'status'])
@Index('idx_user_created', ['user', 'created_at'])
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  // Mã đơn hàng (ví dụ: ORD-20260520-001)
  @Column({ type: 'varchar', length: 50, unique: true })
  order_code: string;

  // Người đặt hàng
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Tổng tiền đơn hàng
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0.0 })
  total_amount: number;

  // Phí vận chuyển
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0 })
  shipping_fee: number;

  // Mã giảm giá (nếu có)
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0 })
  discount_amount: number;

  // Số tiền thực thanh toán (total_amount + shipping_fee - discount_amount)
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0.0 })
  final_amount: number;

  /**
   * Đơn vị tiền của đơn — CHỤP LẠI lúc đặt, không đọc lại từ sản phẩm.
   *
   * Người bán đổi tiền tệ của tin đăng sau khi đơn đã đặt là chuyện có thật, và
   * khi đó đơn cũ phải giữ nguyên thứ nó đã thoả thuận. Đọc `product.currency`
   * lúc hiển thị thì một đơn 1.890.000 VND có thể biến thành 1.890.000 USD chỉ
   * vì người bán sửa tin — hoá đơn tự đổi số sau lưng người mua.
   *
   * Cùng lý do mà `order_items` đã chụp lại tên và giá sản phẩm.
   */
  @Column({ type: 'char', length: 3, default: 'VND' })
  currency: string;

  // Trạng thái đơn hàng
  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  // Phương thức thanh toán
  @Column({
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.COD,
  })
  payment_method: PaymentMethod;

  // Trạng thái thanh toán
  @Column({ type: 'tinyint', width: 1, default: 0 })
  is_paid: boolean;

  // Ngày thanh toán (nếu có)
  @Column({ type: 'datetime', nullable: true })
  paid_at: Date;

  // Tên người nhận hàng
  @Column({ type: 'varchar', length: 100 })
  receiver_name: string;

  // Số điện thoại người nhận
  @Column({ type: 'varchar', length: 20 })
  receiver_phone: string;

  // Địa chỉ giao hàng
  @Column({ type: 'text' })
  shipping_address: string;

  // Tỉnh/Thành phố
  @Column({ type: 'varchar', length: 100, nullable: true })
  province: string;

  // Quận/Huyện
  @Column({ type: 'varchar', length: 100, nullable: true })
  district: string;

  @Column({ type: 'int', nullable: true })
  ghn_district_id: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  ghn_ward_code: string;

  // Ghi chú đơn hàng
  @Column({ type: 'text', nullable: true })
  note: string;

  // Mã vận đơn (tracking code)
  @Column({ type: 'varchar', length: 100, nullable: true })
  tracking_code: string;

  // Ngày tạo
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  // Ngày cập nhật
  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;

  // Xóa mềm
  @DeleteDateColumn({ select: false })
  deleted_at?: Date;

  // Danh sách sản phẩm trong đơn hàng
  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];
}
