import { AuthService } from './auth.service';

/**
 * resetPassword (quên mật khẩu, qua OTP) đổi cột password nhưng không tăng
 * token_version và không làm mới refresh_token. changePassword (đổi mật
 * khẩu khi đã đăng nhập) đã bịt đúng lỗ này bằng cách tăng token_version.
 * resetPassword phải tăng token_version VÀ xoá refresh_token, vì đây
 * chính là lúc một kẻ đang giữ token cũ (lộ mật khẩu/thiết bị) cần bị đá ra
 * NGAY khi chủ tài khoản tự đặt lại mật khẩu.
 */
describe('resetPassword thu hồi phiên cũ', () => {
  const makeService = () => {
    const user = {
      id: 7,
      email: 'a@b.com',
      full_name: 'Bên mua',
      role: 'buyer',
      password: 'old-hash',
      token_version: 2,
      is_locked: false,
    };

    const incrementCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const userRepository = {
      findOne: async () => user,
      update: async (id: number, patch: unknown) => {
        updateCalls.push({ id, patch });
      },
      increment: async (where: { id: number }, col: string, by: number) => {
        incrementCalls.push({ where, col, by });
        (user as any)[col] += by;
      },
    };

    const updateUserToken = jest.fn(async () => undefined);
    const usersService = {
      hashPassword: (p: string) => `hashed:${p}`,
      updateUserToken,
    };

    const cacheManager = {
      get: jest.fn(async () => '123456'),
      del: jest.fn(),
    };

    const service = new AuthService(
      usersService as never,
      { sign: jest.fn(() => 'jwt-token') } as never,
      { get: () => '1d' } as never,
      userRepository as never,
      cacheManager as never,
      {} as never,
    );

    return { service, user, incrementCalls, updateCalls, updateUserToken };
  };

  it('tăng token_version sau khi đặt lại mật khẩu', async () => {
    const { service, user, incrementCalls } = makeService();

    await service.resetPassword('a@b.com', '123456', 'matkhaumoi123');

    expect(incrementCalls).toContainEqual({
      where: { id: 7 },
      col: 'token_version',
      by: 1,
    });
    expect(user.token_version).toBe(3);
  });

  it('xoá refresh_token cũ trong DB', async () => {
    const { service, updateCalls } = makeService();

    await service.resetPassword('a@b.com', '123456', 'matkhaumoi123');

    expect(updateCalls).toContainEqual({ id: 7, patch: { refresh_token: null } });
  });

  it('tài khoản bị khoá vẫn đặt lại được mật khẩu, không nhận 401', async () => {
    const { service, user, updateUserToken } = makeService();
    user.is_locked = true;

    await expect(
      service.resetPassword('a@b.com', '123456', 'matkhaumoi123'),
    ).resolves.toEqual({ message: 'Đặt lại mật khẩu thành công' });
    expect(updateUserToken).not.toHaveBeenCalled();
  });
});
