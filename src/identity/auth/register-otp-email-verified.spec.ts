import { AuthService } from './auth.service';
import { UsersService } from '@identity/users/users.service';
import { UserRole } from '@identity/users/entities/user.entity';

/**
 * Đăng ký qua OTP đã tự chứng minh quyền sở hữu email (gõ đúng mã gửi về
 * email), nhưng verifyRegisterOtp tạo tài khoản qua usersService.register()
 * giống hệt đường đăng ký thường, không hề đánh dấu email đã xác thực. Kết
 * quả: tài khoản OTP và tài khoản đăng ký thường (chưa chứng minh gì) trông
 * giống nhau ở cột email_verified.
 *
 * Tài khoản tạo qua OTP phải lưu email_verified = true NGAY LÚC TẠO. Đường
 * đăng ký thường (POST /auth/register, không OTP) phải giữ nguyên hành vi
 * cũ: email_verified = false.
 */
describe('verifyRegisterOtp đánh dấu email đã xác thực', () => {
  type DongDaLuu = { email_verified?: boolean; role?: UserRole };

  const makeRepo = () => {
    let saved: DongDaLuu = {};
    const repo = {
      findOne: () => Promise.resolve(null),
      create: (x: DongDaLuu) => x,
      save: (x: DongDaLuu) => {
        saved = x;
        return Promise.resolve(x);
      },
    };
    return { repo, getSaved: () => saved };
  };

  const makeAuthService = (repo: unknown, cacheData: unknown) =>
    new AuthService(
      new UsersService(repo as never),
      {} as never,
      {} as never,
      {} as never,
      {
        get: () => Promise.resolve(cacheData),
        del: jest.fn(),
      } as never,
      {} as never,
    );

  it('tài khoản tạo qua OTP có email_verified = true', async () => {
    const { repo, getSaved } = makeRepo();
    const service = makeAuthService(repo, {
      otp: '123456',
      full_name: 'Bên mua',
    });

    await service.verifyRegisterOtp('a@b.com', '123456', 'matkhau123');

    expect(getSaved().email_verified).toBe(true);
    expect(getSaved().role).toBe(UserRole.BUYER);
  });

  it('đăng ký thường (không OTP) vẫn giữ email_verified = false', async () => {
    const { repo, getSaved } = makeRepo();
    const service = makeAuthService(repo, undefined);

    await service.register({
      full_name: 'Bên mua',
      email: 'c@d.com',
      password: 'matkhau123',
    });

    expect(getSaved().email_verified).toBe(false);
  });
});
