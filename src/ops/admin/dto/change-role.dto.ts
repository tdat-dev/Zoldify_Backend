import { IsString, IsIn } from 'class-validator';

/** Vai trò admin được đặt qua API. Dùng chung với AdminService.changeUserRole. */
export const VAI_TRO_DAT_DUOC = ['buyer', 'seller', 'admin'];

/**
 * DTO cho `PATCH /admin/users/:id/role` — chặn field thừa (M-07).
 */
export class ChangeRoleDto {
  // KHÔNG có 'moderator': không guard, không màn nào biết vai trò đó được làm
  // gì, nên tài khoản bị đặt `moderator` rơi vào khoảng trống. Giá trị vẫn nằm
  // trong enum của entity vì cột ENUM trong database có nó; chỉ không cho đặt
  // MỚI qua API (doi-vai-tro-khong-moderator.spec.ts).
  @IsString()
  @IsIn(VAI_TRO_DAT_DUOC)
  role!: string;
}
