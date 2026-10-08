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
import { Order } from '@ordering/orders/entities/order.entity';
import { User } from '@identity/users/entities/user.entity';

export enum EscrowStatus {
  HOLDING = 'holding',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
}

@Entity('escrows')
@Index('idx_order', ['order'])
@Index('idx_seller', ['seller'])
/**
 * MỘT NGƯỜI BÁN, MỘT KHOẢN KÝ QUỸ TRONG MỘT ĐƠN.
 *
 * `createOrderEscrows` đã chặn bằng `if (already > 0) return ...`, nhưng đó là
 * đọc-rồi-ghi không khoá: hai request song song cùng đọc thấy 0 rồi cùng ghi.
 * Hai khoản cho một người bán nghĩa là giải ngân hai lần — và khác với sổ cái,
 * chỗ này KHÔNG có `idempotency_key` che cho, vì mỗi khoản có id riêng nên hai
 * lần `release` sinh ra hai khoá khác nhau.
 *
 * Khai ở entity (cho `synchronize` lúc chạy test) VÀ ở migration
 * `1787600000000` (cho lược đồ thật) — cùng cách mà `order_shipments` làm với
 * `uq_shipment_order_seller`.
 */
@Index('uq_escrow_order_seller', ['order', 'seller'], { unique: true })
export class Escrow {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  /** Tiền HÀNG của người bán này — tổng `subtotal` các món của họ. Phí sàn tính trên đúng số này. */
  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  /**
   * Phần PHÍ SHIP của người bán này, tách riêng khỏi tiền hàng.
   *
   * VÌ SAO PHẢI CÓ CỘT RIÊNG. Người mua trả `final_amount` (hàng + ship) và cả
   * số đó chảy vào `platform/escrow_hold`. Nhưng trước 24/09 khoản ký quỹ chỉ
   * ghi tiền hàng, nên phần ship KHÔNG CÓ ĐƯỜNG NÀO RA khỏi két: giải ngân thì
   * người bán không nhận được nó, hoàn tiền thì người mua cũng không. Nó đọng
   * lại mãi mãi, mỗi đơn một ít. Đo bằng TC-P0-04a/b.
   *
   * VÌ SAO KHÔNG GỘP VÀO `amount`. Vì phí sàn tính trên `amount`, mà theo quyết
   * định của Đạt (24/09): *"Tiền ship bên mua bán họ tự trả chứ sàn không thu
   * tiền"*. Sàn chỉ cầm hộ rồi chuyển đi — không được ăn phần trăm trên đó.
   * Gộp hai con số vào một cột là mất đúng ranh giới ấy.
   *
   * Đơn cũ (trước migration) để 0, nên tiền ship của chúng vẫn kẹt — cần đối
   * soát tay nếu production đã có đơn thật.
   */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0.0 })
  shipping_amount: number;

  @Column({
    type: 'enum',
    enum: EscrowStatus,
    default: EscrowStatus.HOLDING,
  })
  status: EscrowStatus;

  @Column({ type: 'datetime', nullable: true })
  released_at: Date;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
