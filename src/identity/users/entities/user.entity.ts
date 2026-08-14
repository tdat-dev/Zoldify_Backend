import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ApiHideProperty } from '@nestjs/swagger';

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
  @ApiHideProperty()
  @Column({ type: 'varchar', length: 255, select: false }) // select: false: khi select * thì sẽ không trả về password
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

  // Không còn cột `balance` ở đây.
  //
  // Số dư nằm ở `ledger_accounts`, đọc bằng
  // `LedgerService.getBalance(USER, id, AVAILABLE)`. Cột cũ là một trong ba
  // nguồn sự thật từng tồn tại song song và lệch nhau; xem migration
  // 1786600000000-DropUserBalanceColumn.

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

  /**
   * Token làm mới (refresh token) để duy trì đăng nhập.
   *
   * `select: false` — GIỐNG password, và vì đúng một lý do.
   *
   * Trước đây cột này chỉ có @ApiHideProperty(). Thứ đó CHỈ giấu khỏi trang tài
   * liệu Swagger; nó không hề ảnh hưởng tới dữ liệu thật trả về. Hậu quả đo
   * được: GET /api/v1/products — công khai, không cần đăng nhập — nạp
   * `relations: ['seller']` tức nguyên bản ghi users, nên mỗi sản phẩm kèm theo
   * refresh token còn hiệu lực của người bán. Giải mã ra là một JWT hợp lệ
   * mang sub/role của họ, hạn còn một tuần.
   *
   * An toàn để khoá vì cột này chỉ được GHI (auth.service, users.service),
   * không chỗ nào đọc lại để kiểm tra. Khác với token_version — cột đó
   * jwt.strategy đọc mỗi request, khoá nó là chặn đăng nhập toàn hệ thống.
   */
  @ApiHideProperty()
  @Column({ type: 'varchar', length: 500, nullable: true, select: false })
  refresh_token: string;

  // Phiên bản token (tăng mỗi lần đổi token)
  @ApiHideProperty()
  @Column({ type: 'int', default: 0 })
  token_version: number;

  // Ngày tạo tài khoản - TIMESTAMP (tự động gán khi tạo)
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  // Xóa mềm
  @DeleteDateColumn()
  deleted_at?: Date;
}
