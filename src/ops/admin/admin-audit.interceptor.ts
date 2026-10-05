import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import { AdminGuard } from '@common/guards/admin.guard';
import { AdminActionLog } from './entities/admin-action-log.entity';

/** Một dòng nhật ký trước khi database gán `id` và `created_at`. */
type DongNhatKy = Omit<AdminActionLog, 'id' | 'created_at'>;

/**
 * Ghi lại mọi hành động đổi trạng thái đi qua `AdminGuard` (task #34).
 *
 * VÌ SAO LÀ INTERCEPTOR CHỨ KHÔNG RẢI LỜI GỌI TRONG TỪNG SERVICE.
 *
 * 19 route admin nằm ở NĂM controller: `admin`, `users`, `wallets`,
 * `withdrawals.admin`, `settings`. Rải `ghiNhatKy(...)` vào từng service thì
 * chỉ cần quên một chỗ là mất vết — và chỗ quên bao giờ cũng là route thêm
 * sau, tức route chưa ai kịp nghĩ kỹ. Ở đây điều kiện được ghi gắn vào chính
 * `AdminGuard`: gắn guard là có nhật ký, không ai phải nhớ thêm bước nào.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(
    @InjectRepository(AdminActionLog)
    private readonly repo: Repository<AdminActionLog>,
  ) {}

  /**
   * Khoá bị xoá khỏi payload trước khi ghi.
   *
   * Nhật ký là thứ đọc nhiều, sao chép nhiều, dán vào báo cáo nhiều. Một mật
   * khẩu lọt vào đây biến bảng gác an ninh thành kho rò rỉ — và nó rò rỉ ở
   * đúng chỗ không ai nghĩ tới việc phải bảo vệ.
   *
   * `PATCH /admin/users/:id` nhận `dto: any`, nghĩa là nó nhận MỌI field
   * client gửi lên. Nên danh sách này chặn theo tên khoá chứ không tin DTO.
   */
  private static readonly KHOA_NHAY_CAM = [
    'password',
    'new_password',
    'old_password',
    'password_confirmation',
    'refresh_token',
    'access_token',
    'token',
    'secret',
    'otp',
    'authorization',
  ];

  /** Phương thức đổi trạng thái. GET/HEAD/OPTIONS là đọc, không ghi. */
  private static readonly DOI_TRANG_THAI = ['POST', 'PATCH', 'PUT', 'DELETE'];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{
      method: string;
      originalUrl?: string;
      url?: string;
      user?: { id: number };
      body?: Record<string, unknown>;
      params?: Record<string, string>;
      ip?: string;
      get?: (h: string) => string | undefined;
    }>();

    const method = (req.method || '').toUpperCase();
    const canGhi =
      AdminAuditInterceptor.DOI_TRANG_THAI.includes(method) &&
      this.laRouteAdmin(context) &&
      typeof req.user?.id === 'number';

    if (!canGhi) return next.handle();

    const duongDan = req.originalUrl ?? req.url ?? '';
    const adminId = req.user!.id;
    const payload = this.locKhoaNhayCam(req.body);

    return next.handle().pipe(
      // `tap` chứ không ghi trước khi gọi handler: chỉ ghi khi hành động THỰC
      // SỰ chạy xong. Ghi trước thì mọi request bị 404/422/xung đột cũng để
      // lại một dòng "admin đã xoá người dùng" — nhật ký nói dối theo hướng
      // buộc tội người vô can.
      tap({
        next: () => {
          const status = http.getResponse<{ statusCode?: number }>()
            ?.statusCode;
          void this.ghi({
            admin_id: adminId,
            method,
            path: duongDan.slice(0, 512),
            action: this.datTenHanhDong(method, duongDan),
            target_type: this.doanLoaiMucTieu(duongDan),
            target_id: req.params?.id ?? null,
            status_code: typeof status === 'number' ? status : null,
            ip: (req.ip ?? null)?.slice(0, 45) ?? null,
            user_agent: req.get?.('user-agent')?.slice(0, 255) ?? null,
            payload,
          });
        },
      }),
    );
  }

  /**
   * Route này có `AdminGuard` không — đọc metadata Nest gắn trên hàm xử lý và
   * trên lớp controller.
   *
   * Phải kiểm CẢ HAI: `AdminController` gắn guard ở cấp lớp
   * (`@UseGuards(JwtAuthGuard, AdminGuard)` trên class), còn vài controller
   * khác chỉ gắn trên đúng một phương thức. Chỉ đọc một trong hai chỗ là bỏ
   * lọt cả một nhóm route.
   */
  private laRouteAdmin(context: ExecutionContext): boolean {
    const co = (target: unknown) => {
      if (!target) return false;
      const guards = Reflect.getMetadata('__guards__', target) as
        | unknown[]
        | undefined;
      return Array.isArray(guards) && guards.some((g) => g === AdminGuard);
    };
    return co(context.getHandler()) || co(context.getClass());
  }

  /** `/api/v1/admin/users/42/toggle-lock` → `admin.users.toggle-lock` */
  private datTenHanhDong(method: string, duongDan: string): string {
    const doan = duongDan
      .split('?')[0]
      .split('/')
      .filter((p) => p && p !== 'api' && !/^v\d+$/.test(p))
      // Bỏ id ra khỏi tên hành động: giữ lại thì mỗi lần khoá một người là một
      // tên khác nhau, và không đếm được "khoá tài khoản" đã xảy ra bao nhiêu lần.
      .filter((p) => !/^\d+$/.test(p));
    return (doan.join('.') || method.toLowerCase()).slice(0, 100);
  }

  /** Đoạn đầu sau tiền tố phiên bản: `users`, `withdrawals`, `settings`… */
  private doanLoaiMucTieu(duongDan: string): string | null {
    const doan = duongDan
      .split('?')[0]
      .split('/')
      .filter((p) => p && p !== 'api' && !/^v\d+$/.test(p));
    // doan[0] thường là `admin`; loại mục tiêu nằm ngay sau nó.
    const loai = doan[0] === 'admin' ? doan[1] : doan[0];
    return loai ? loai.slice(0, 50) : null;
  }

  /** Bỏ khoá nhạy cảm ở mọi độ sâu, giữ nguyên phần còn lại. */
  private locKhoaNhayCam(body: unknown): Record<string, unknown> | null {
    if (!body || typeof body !== 'object') return null;

    const loc = (v: unknown, sau = 0): unknown => {
      // Chặn độ sâu: thân request lồng nhau quá mức (hoặc có vòng lặp) không
      // được phép làm treo tiến trình ghi log.
      if (sau > 5) return '[qua-sau]';
      if (Array.isArray(v)) return v.map((x) => loc(x, sau + 1));
      if (v && typeof v === 'object') {
        const ra: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          ra[k] = AdminAuditInterceptor.KHOA_NHAY_CAM.includes(k.toLowerCase())
            ? '[da-an]'
            : loc(val, sau + 1);
        }
        return ra;
      }
      return v;
    };

    const ketQua = loc(body) as Record<string, unknown>;
    return Object.keys(ketQua).length ? ketQua : null;
  }

  /**
   * GHI FAIL-OPEN, CÓ CHỦ Ý.
   *
   * Bảng này mới, nên sẽ có máy chưa chạy migration. Nếu lỗi ghi log ném ra
   * ngoài thì admin không khoá được một tài khoản lừa đảo chỉ vì bảng nhật ký
   * chưa tồn tại — đổi một tính năng phụ thành cả chức năng quản trị ngừng
   * hoạt động. Đánh đổi nằm ở đây và nói thẳng: **mất vết còn hơn mất quyền
   * quản trị**, nhưng lỗi phải hiện trong log máy chủ để không ai tưởng nhật
   * ký vẫn đang chạy.
   */
  private async ghi(row: DongNhatKy): Promise<void> {
    try {
      // `create` rồi `save` chứ không `insert(row)` thẳng: kiểu
      // `QueryDeepPartialEntity` của TypeORM coi cột `json` là "hoặc một object
      // sâu, hoặc một hàm sinh SQL", nên một `Record<string, unknown>` bình
      // thường không khớp. `create` trả về đúng thực thể nên hết mập mờ.
      await this.repo.save(this.repo.create(row));
    } catch (e) {
      this.logger.error(
        `Khong ghi duoc nhat ky hanh dong admin (${row.method} ${row.path}): ` +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }
}
