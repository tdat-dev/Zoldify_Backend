import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Nhật ký hành động quản trị (task #34).
 *
 * BẢNG NÀY CHỈ GHI THÊM, KHÔNG SỬA, KHÔNG XOÁ. Vì vậy nó cố tình KHÔNG có
 * `updated_at` và KHÔNG có `deleted_at`: một dòng nhật ký sửa được thì nó
 * không còn là bằng chứng nữa, và đúng người muốn sửa nó là người có quyền
 * admin — tức người mà bảng này sinh ra để giám sát.
 *
 * KHÔNG khai quan hệ `@ManyToOne` tới `User`.
 *
 * Nghe thì tiện hơn, nhưng quan hệ TypeORM kéo theo hai thứ không muốn: nó mời
 * gọi `relations: ['admin']` làm mỗi lần đọc nhật ký thành một JOIN, và nó gắn
 * vòng đời dòng nhật ký vào vòng đời người dùng. Ở đây chỉ giữ `admin_id` trần
 * — vết phải sống lâu hơn tài khoản gây ra nó.
 */
@Entity('admin_action_logs')
// Câu hỏi thường gặp nhất khi có sự cố là "ai đã đụng vào bản ghi này", nên
// index ghép theo (mục tiêu, thời gian) chứ không phải hai index rời.
@Index('idx_target_created', ['target_type', 'target_id', 'created_at'])
// Câu hỏi thường gặp thứ hai: "admin X đã làm những gì".
@Index('idx_admin_created', ['admin_id', 'created_at'])
export class AdminActionLog {
  @PrimaryGeneratedColumn()
  id: number;

  /** `users.id` của admin thực hiện. Để trần, xem ghi chú ở đầu file. */
  @Column({ type: 'int' })
  admin_id: number;

  /** GET · POST · PATCH · PUT · DELETE */
  @Column({ type: 'varchar', length: 10 })
  method: string;

  /**
   * Đường dẫn đã gọi, giữ nguyên tham số đường dẫn.
   *
   * 512 chứ không 255: query string của `/admin/users?q=...&role=...` dài
   * bất ngờ, mà cột quá ngắn thì MySQL **cắt cụt trong im lặng** ở chế độ
   * mặc định — nhật ký mất phần đuôi mà không ai được báo.
   */
  @Column({ type: 'varchar', length: 512 })
  path: string;

  /** Tên hành động đã chuẩn hoá, ví dụ `admin.users.toggle-lock`. */
  @Column({ type: 'varchar', length: 100 })
  action: string;

  /** Loại đối tượng bị tác động, ví dụ `users`, `withdrawals`, `settings`. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  target_type: string | null;

  /** Id đối tượng, để chuỗi vì có route dùng khoá không phải số. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  target_id: string | null;

  @Column({ type: 'int', nullable: true })
  status_code: number | null;

  /**
   * IP người gọi, lấy từ `req.ip`.
   *
   * 45 ký tự vì IPv6 dạng ánh xạ IPv4 (`::ffff:255.255.255.255`) dài 45.
   * Từ task #6 có Caddy đứng trước api, nên giá trị này chỉ đúng nhờ
   * `trust proxy` đã bật trong `main.ts` — cùng lý do đã ghi ở
   * `src/core/swagger-guard.ts:90`.
   */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user_agent: string | null;

  /**
   * Thân request ĐÃ LỌC khoá nhạy cảm. Xem `admin-audit.interceptor.ts`.
   *
   * `json` chứ không `text`: cần truy vấn được `payload->'$.role'` khi đi tìm
   * "ai đã nâng ai lên admin".
   */
  @Column({ type: 'json', nullable: true })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
