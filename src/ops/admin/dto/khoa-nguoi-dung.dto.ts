import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body tuỳ chọn của PATCH /admin/users/:id/toggle-lock.
 *
 * Có `is_locked` thì đặt ĐÚNG trạng thái đó (gọi lại bao nhiêu lần cũng vậy);
 * bỏ trống thì lật như cũ, vì web admin hiện gọi route này không có body.
 */
export class KhoaNguoiDungDto {
  @IsOptional()
  @IsBoolean({ message: 'is_locked phải là true hoặc false' })
  is_locked?: boolean;
}
