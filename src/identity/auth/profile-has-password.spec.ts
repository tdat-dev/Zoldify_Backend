import { AuthService } from './auth.service';

/**
 * `GET /auth/profile` phải báo đúng tài khoản đã có mật khẩu chưa (lỗi H-05,
 * test E2E 30/09).
 *
 * Cột `users.password` khai `select: false`, nên `userRepository.findOne`
 * KHÔNG trả về nó và `has_password: !!user.password` luôn là false, với MỌI
 * người. App thấy false thì hiện màn "Đặt mật khẩu" (không có ô mật khẩu cũ);
 * `changePassword` thì đọc qua `findOneByEmail` (có chọn cột password), thấy
 * tài khoản có mật khẩu và đòi mật khẩu cũ, nên từ chối. Người có mật khẩu
 * không đổi được mật khẩu trên app.
 *
 * Bài kiểm dựng repository giả y như TypeORM thật: findOne không có password.
 */
describe('AuthService.getProfile: has_password', () => {
  const baseUser = {
    id: 5,
    full_name: 'A',
    email: 'a@t.local',
    role: 'buyer',
    avatar: '',
    phone_number: '',
    gender: '',
    email_verified: 1,
  };

  const makeService = (storedPassword: string) =>
    new AuthService(
      {
        // Như UsersService thật: query builder có addSelect password.
        findOneByEmail: () =>
          Promise.resolve({ ...baseUser, password: storedPassword }),
      } as never,
      {} as never,
      {} as never,
      // Như TypeORM thật: findOne bỏ qua cột select:false.
      { findOne: () => Promise.resolve({ ...baseUser }) } as never,
      {} as never,
      {} as never,
    );

  it('tài khoản có mật khẩu -> has_password: true', async () => {
    const profile = await makeService('$2b$10$hash').getProfile(5);
    expect(profile.has_password).toBe(true);
  });

  it('tài khoản Google chưa đặt mật khẩu (password rỗng) -> false', async () => {
    const profile = await makeService('').getProfile(5);
    expect(profile.has_password).toBe(false);
  });

  it('không trả mật khẩu hay hash ra ngoài', async () => {
    const profile = await makeService('$2b$10$hash').getProfile(5);
    expect(JSON.stringify(profile)).not.toContain('$2b$');
  });
});
