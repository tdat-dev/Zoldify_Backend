import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '@identity/users/entities/user.entity';

export enum ShopStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}

@Entity('shops')
export class Shop {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  logo: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  banner: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  /**
   * Địa chỉ LẤY HÀNG của người bán — nguồn gửi cho vận đơn GHN.
   *
   * Zoldify là sàn C2C: mỗi người bán tự gửi hàng từ nhà mình, KHÔNG có kho
   * chung của sàn. Nên "from" của mỗi vận đơn phải là địa chỉ này, không phải
   * một điểm gửi cố định trong biến môi trường.
   *
   * Lưu cả ID lẫn TÊN vì GHN dùng hai kiểu ở hai chỗ:
   *   · tính phí  -> cần district_id (số) + ward_code
   *   · tạo đơn   -> cần from_district_name / from_ward_name / from_province_name (chữ)
   * Cả hai lấy được cùng lúc từ danh mục /ghn/provinces|districts|wards, nên
   * chụp lại luôn để khỏi tra ngược tên<->id về sau.
   *
   * Nullable vì shop cũ chưa khai; chưa đủ pickup thì rơi về shop GHN mặc định
   * của sàn (GHN_SHOP_ID) — xem GhnService. Bắt buộc khai đủ trước khi bán.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  pickup_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  pickup_phone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pickup_address: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  pickup_province_name: string;

  @Column({ type: 'int', nullable: true })
  pickup_district_id: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  pickup_district_name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  pickup_ward_code: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  pickup_ward_name: string;

  @Column({ type: 'enum', enum: ShopStatus, default: ShopStatus.ACTIVE })
  status: ShopStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
