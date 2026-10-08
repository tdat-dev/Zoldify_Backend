import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminActionLog } from './entities/admin-action-log.entity';

export interface TraNhatKyDto {
  page?: number;
  limit?: number;
  admin_id?: number;
  target_type?: string;
  target_id?: string;
}

/**
 * Đọc nhật ký hành động quản trị (task #34).
 *
 * Chỉ có ĐỌC. Không có sửa, không có xoá, và đó là chủ ý — xem ghi chú ở đầu
 * `admin-action-log.entity.ts`: một dòng nhật ký sửa được thì không còn là
 * bằng chứng, và đúng người muốn sửa nó là người có quyền admin.
 */
@Injectable()
export class AdminAuditService {
  /**
   * Trần số dòng mỗi trang.
   *
   * Cùng lý do với chặn limit toàn hệ ở Epic 3: một `?limit=1000000` từ trang
   * quản trị dựng một triệu entity trong RAM của tiến trình api, mà Node chỉ
   * có một luồng JS — mọi người dùng khác xếp hàng sau nó. Chặn ở đây chứ
   * không tin client, vì client ở đây là trang admin do chính nhóm viết và nó
   * sẽ đổi mà không ai báo backend.
   */
  private static readonly TRAN_MOI_TRANG = 100;

  constructor(
    @InjectRepository(AdminActionLog)
    private readonly repo: Repository<AdminActionLog>,
  ) {}

  async tra(dto: TraNhatKyDto) {
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(
      AdminAuditService.TRAN_MOI_TRANG,
      Math.max(1, Number(dto.limit) || 20),
    );

    // Chỉ lọc theo hai chiều mà bảng CÓ index ghép:
    //   (target_type, target_id, created_at) và (admin_id, created_at).
    // Thêm bộ lọc thứ ba mà không thêm index là mời một lần quét toàn bảng —
    // đúng loại lỗi mà `check:index` sinh ra để chặn.
    const where: Record<string, unknown> = {};
    if (dto.admin_id) where.admin_id = Number(dto.admin_id);
    if (dto.target_type) where.target_type = dto.target_type;
    if (dto.target_id) where.target_id = String(dto.target_id);

    const [result, total] = await this.repo.findAndCount({
      where,
      // Mới nhất trước: người đi tra cần việc vừa xảy ra, không phải việc đầu
      // tiên từng xảy ra.
      order: { created_at: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result,
    };
  }
}
