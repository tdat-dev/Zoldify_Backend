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
import { User } from '@identity/users/entities/user.entity';

export enum ShipmentStatus {
  /** Đã tạo vận đơn GHN thành công, có tracking_code. */
  CREATED = 'created',
  /** Gọi GHN lỗi — giữ lại để hiện cho người bán và cho phép tạo lại. */
  FAILED = 'failed',
  /** GHN báo đã giao tới người mua (đồng bộ tự động ở GĐ2). Chưa giải ngân —
   *  còn chờ người mua xác nhận hoặc hết cửa sổ tự-xác-nhận. */
  DELIVERED = 'delivered',
  /** Người mua đã xác nhận nhận hàng (hoặc hệ thống tự xác nhận sau N ngày) —
   *  escrow của người bán này đã được giải ngân. Trạng thái CUỐI. */
  RECEIVED = 'received',
}

/**
 * Một lô hàng của MỘT người bán trong một đơn.
 *
 * Zoldify cho phép một đơn gồm hàng của nhiều người bán (xem OrdersService.create
 * và EscrowsService.createOrderEscrows đã tách tiền theo người bán). Nhưng vận
 * đơn GHN thì trước đây gộp làm một ở cấp Order (chỉ một `order.tracking_code`),
 * nên hàng của nhiều người bán bị coi như gửi từ một chỗ.
 *
 * Bảng này mirror đúng pattern (order, seller) của Escrow: mỗi người bán trong
 * đơn có một dòng riêng — tracking_code riêng, tiền thu hộ (COD) riêng, trạng
 * thái riêng — vì mỗi người bán tự gửi hàng từ địa chỉ của mình.
 *
 * Địa chỉ NGƯỜI NHẬN vẫn nằm ở Order (một đơn một người mua). Địa chỉ NGƯỜI GỬI
 * là pickup của Shop người bán, đọc lúc tạo vận đơn — không chép lại ở đây.
 */
@Entity('order_shipments')
@Index('idx_shipment_order', ['order'])
@Index('idx_shipment_seller', ['seller'])
@Index('uq_shipment_order_seller', ['order', 'seller'], { unique: true })
export class OrderShipment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  // Mã vận đơn GHN của riêng lô hàng người bán này.
  @Column({ type: 'varchar', length: 100, nullable: true })
  tracking_code: string;

  // Tiền thu hộ (COD) của riêng phần người bán này — tổng subtotal các món của
  // họ, chứ KHÔNG phải cả đơn.
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0.0 })
  cod_amount: number;

  @Column({
    type: 'enum',
    enum: ShipmentStatus,
    default: ShipmentStatus.CREATED,
  })
  status: ShipmentStatus;

  // Thông điệp lỗi GHN gần nhất (nếu FAILED) — để người bán/admin biết vì sao.
  @Column({ type: 'text', nullable: true })
  error: string;

  // Mốc GHN báo đã giao (điền khi đồng bộ trạng thái GHN ở GĐ2). Là gốc để đếm
  // cửa sổ tự-xác-nhận: quá N ngày kể từ đây mà người mua chưa bấm thì tự chốt.
  @Column({ type: 'timestamp', nullable: true })
  delivered_at: Date;

  // Mốc người mua xác nhận nhận hàng (hoặc hệ thống tự xác nhận) — cũng là lúc
  // escrow của người bán này được giải ngân.
  @Column({ type: 'timestamp', nullable: true })
  received_at: Date;

  // true nếu chuyển sang RECEIVED do hệ thống tự chốt (hết cửa sổ), không phải
  // người mua bấm tay — để đối soát và hiển thị khác nhau.
  @Column({ type: 'boolean', default: false })
  auto_received: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
