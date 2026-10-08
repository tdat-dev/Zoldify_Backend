import { IsString, IsIn } from 'class-validator';

/**
 * DTO cho `PATCH /admin/users/:id/role` — chặn field thừa (M-07).
 */
export class ChangeRoleDto {
  @IsString()
  @IsIn(['buyer', 'seller', 'admin', 'moderator'])
  role!: string;
}
