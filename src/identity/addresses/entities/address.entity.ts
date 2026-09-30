import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '@identity/users/entities/user.entity';

@Entity('addresses')
export class Address {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  recipient_name: string;

  @Column({ type: 'varchar', length: 20 })
  phone_number: string;

  @Column({ type: 'varchar', length: 50, default: 'Nhà riêng' })
  label: string;

  /**
   * Mã quốc gia ISO 3166-1 alpha-2 ('VN', 'US', 'JP'…).
   *
   * Đứng TRƯỚC province vì nó quyết định mấy ô còn lại có nghĩa gì: 'province /
   * district / ward' là ba cấp hành chính của Việt Nam. Nước khác chia khác —
   * Mỹ có state/city/ZIP, Nhật có prefecture/city/chōme. Cột này chưa làm cho
   * biểu mẫu tự đổi theo nước, nhưng nó ghi lại được ĐỊA CHỈ NÀY THUỘC NƯỚC NÀO,
   * là thứ tối thiểu phải có trước khi làm việc đó.
   *
   * Mặc định 'VN' cho mọi dòng đang có: tất cả địa chỉ trong database lúc này
   * đều nhập bằng bộ chọn tỉnh/huyện/xã Việt Nam, nên đó là sự thật chứ không
   * phải phỏng đoán.
   */
  @Column({ type: 'char', length: 2, default: 'VN' })
  country: string;

  @Column({ type: 'varchar', length: 100 })
  province: string;

  @Column({ type: 'varchar', length: 100 })
  district: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ward: string;

  @Column({ type: 'varchar', length: 255 })
  street: string;

  // Mã GHN để tính phí ship — lưu lúc thêm địa chỉ (form đã có sẵn). Nullable:
  // địa chỉ cũ chưa có mã, checkout sẽ bắt chọn lại khi thiếu. ward là CHUỖI.
  @Column({ type: 'int', nullable: true })
  ghn_province_id: number;

  @Column({ type: 'int', nullable: true })
  ghn_district_id: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  ghn_ward_code: string;

  // tinyint(1) -> driver mysql2 trả 0/1. Không có transformer thì API trả
  // `"is_default": 1`, app gửi lại nguyên giá trị và UpdateAddressDto
  // (@IsBoolean) từ chối: không ai sửa được địa chỉ (lỗi H-04, 30/09).
  @Column({
    type: 'tinyint',
    width: 1,
    default: 0,
    transformer: {
      to: (v?: boolean | null) => (v == null ? v : v ? 1 : 0),
      from: (v?: number | string | null) => (v == null ? v : Number(v) === 1),
    },
  })
  is_default: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}
