import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangeRoleDto } from './change-role.dto';

/**
 * Admin đặt được vai trò `moderator` cho người dùng, mà không chỗ nào trong
 * hệ thống biết `moderator` được làm gì: không guard nào kiểm nó, không màn
 * nào hiện nó. Tài khoản bị đặt `moderator` rơi vào khoảng trống, mất quyền
 * người bán (route người bán kiểm `seller`) mà không được thêm quyền gì.
 *
 * Giá trị enum vẫn giữ trong entity vì cột ENUM trong database có nó; chỉ
 * không cho ĐẶT mới qua API nữa.
 */
describe('ChangeRoleDto không nhận moderator', () => {
  const loi = async (role: unknown) =>
    (await validate(plainToInstance(ChangeRoleDto, { role }))).length;

  it.each(['buyer', 'seller', 'admin'])('"%s" hợp lệ', async (r) => {
    expect(await loi(r)).toBe(0);
  });

  it('"moderator" bị từ chối', async () => {
    expect(await loi('moderator')).toBeGreaterThan(0);
  });
});
