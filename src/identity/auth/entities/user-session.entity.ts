import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '@identity/users/entities/user.entity';

/**
 * Một lần đăng nhập, một dòng. `id` chính là `sid` trong JWT.
 *
 * Trước bảng này `users` chỉ có token_version và một cột refresh_token, nên
 * "thu hồi" chỉ có một nghĩa: thu hồi MỌI máy. Đăng xuất ở máy B là máy A đang
 * dùng cũng mất phiên, không báo trước (thẻ Trello P2). Giờ có hai mức:
 * token_version vẫn là "đá hết" (đổi mật khẩu, khoá, dùng lại refresh token),
 * còn `revoked_at` của một dòng là "đá đúng máy này".
 *
 * `refresh_hash` là SHA-256, cùng lý do với users.refresh_token: đọc được bảng
 * này không có nghĩa cầm được phiên của ai (xem bamRefresh ở auth.service.ts).
 *
 * Tên index/FK và precision khai RÕ để khớp `1788800000000-CreateUserSessions.ts`,
 * thiếu là check:drift (ngưỡng 0) bắt ngay, như đã kể ở push-token.entity.ts.
 * Index (user_id, expires_at) phục vụ câu dọn dòng hết hạn lúc đăng nhập và làm
 * luôn index cho khoá ngoại, nên không cần index riêng cho user_id.
 */
@Entity('user_sessions')
@Index('idx_phien_user_het_han', ['user_id', 'expires_at'])
export class UserSession {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'int' })
  user_id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_phien_user' })
  user?: User;

  @Column({ type: 'char', length: 64 })
  refresh_hash: string;

  @Column({ type: 'timestamp', precision: 0, nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'timestamp', precision: 0 })
  expires_at: Date;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 0,
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;
}

/**
 * Một định nghĩa "phiên còn sống" cho cả JwtStrategy, socket chat và làm mới.
 *
 * So trong JS chứ không `expires_at > NOW()` trong SQL: kết nối không đặt
 * `timezone`, driver ghi Date theo giờ của tiến trình Node, còn NOW() theo giờ
 * của MySQL. Hai máy lệch múi giờ là phiên chết sớm hoặc sống thêm đúng ngần ấy
 * tiếng. Đọc ra so trong JS thì đi và về cùng một phép đổi, lệch tự triệt tiêu.
 */
export const phienConSong = (
  phien: Pick<UserSession, 'revoked_at' | 'expires_at'> | null | undefined,
): boolean =>
  !!phien && !phien.revoked_at && phien.expires_at.getTime() > Date.now();
