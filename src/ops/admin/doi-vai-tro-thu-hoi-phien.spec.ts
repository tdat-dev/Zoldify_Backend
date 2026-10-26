import { AdminService } from './admin.service';

/**
 * B-08: hạ vai trò admin không có hiệu lực cho tới khi token hết hạn.
 *
 * JwtStrategy lấy `role` từ PAYLOAD của access token, không từ DB; AdminGuard
 * tin đúng giá trị đó. changeUserRole chỉ đổi cột role, không tăng
 * token_version, nên một admin vừa bị hạ xuống buyer vẫn cầm token ghi
 * role=admin và dùng tiếp mọi route admin (duyệt rút tiền, sửa settings) tới
 * khi token hết hạn, kể cả làm mới bằng refresh token cũ. Tăng token_version là
 * cách hệ thống đã dùng để thu hồi phiên khi khoá tài khoản (toggleUserLock).
 */
type DongUser = { id: number; role: string; token_version: number };

function dung(user: DongUser) {
  const daLuu: DongUser[] = [];
  const userRepository = {
    findOne: jest.fn(() => Promise.resolve({ ...user })),
    save: jest.fn((u: DongUser) => {
      daLuu.push({ ...u });
      return Promise.resolve(u);
    }),
  };
  const svc = new AdminService(
    userRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, daLuu };
}

describe('Đổi vai trò thu hồi phiên ngay', () => {
  it('hạ admin xuống buyer thì token_version tăng', async () => {
    const { svc, daLuu } = dung({ id: 7, role: 'admin', token_version: 3 });

    await svc.changeUserRole(7, 'buyer');

    expect(daLuu[0].role).toBe('buyer');
    expect(daLuu[0].token_version).toBe(4);
  });

  it('nâng buyer lên seller cũng tăng token_version (token cũ mang vai trò cũ)', async () => {
    const { svc, daLuu } = dung({ id: 8, role: 'buyer', token_version: 0 });

    await svc.changeUserRole(8, 'seller');

    expect(daLuu[0].token_version).toBe(1);
  });
});
