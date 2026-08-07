import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

// Định nghĩa kiểu ENUM cho cột role(các chức năng)
export enum UserRole {
  BUYER = 'buyer',
  SELLER = 'seller',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
}

// Thêm Index trên email và role (theo docs DATABASE.md)
@Index('idx_email', ['email'])
@Index('idx_role', ['role'])
@Entity('users') // Tên bảng trong MySQL
export class User {
  // Định danh tự tăng - INT PK
  @PrimaryGeneratedColumn()
  id: number;

  // Họ tên đầy đủ - VARCHAR(100)
  @Column({ type: 'varchar', length: 100 })
  full_name: string;

  // Email đăng nhập - VARCHAR(150) UNIQUE
  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  // Mật khẩu đã hash (bcrypt) - VARCHAR(255)
  @Column({ type: 'varchar', length: 255, select: false })// select: false: khi select * thì sẽ không trả về password
  password: string;

  // Số điện thoại - VARCHAR(20), có thể null
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone_number: string;

  // Vai trò người dùng - ENUM
  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.BUYER,
  })
  role: UserRole;

  // Đường dẫn ảnh đại diện - VARCHAR(255), có thể null
  @Column({ type: 'varchar', length: 255, nullable: true })
  avatar: string;

  // Số dư tài khoản (legacy, dùng bảng wallets) - DECIMAL(15,2)
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0.00 })
  balance: number;

  // 1 = đã xác thực email - TINYINT(1) (boolean)
  @Column({ type: 'tinyint', width: 1, default: 0 })
  email_verified: boolean;

  // 1 = tài khoản bị khóa - TINYINT(1) (boolean)
  @Column({ type: 'tinyint', width: 1, default: 0 })
  is_locked: boolean;

  // Lần cuối online - DATETIME, có thể null
  @Column({ type: 'datetime', nullable: true })
  last_seen: Date;

  // Giới tính - VARCHAR(10), có thể null
  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: string;

  // Token làm mới (refresh token) để duy trì đăng nhập
  @Column({ type: 'varchar', length: 500, nullable: true })
  refresh_token: string;

  // Phiên bản token (tăng mỗi lần đổi token)
  @Column({ type: 'int', default: 0 })
  token_version: number;

  // Ngày tạo tài khoản - TIMESTAMP (tự động gán khi tạo)
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  // Xóa mềm 
  @DeleteDateColumn()
  deleted_at?: Date;
}