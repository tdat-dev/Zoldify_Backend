import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * OTP 6 số: sinh bằng Math.random và đoán thử không giới hạn.
 *
 *   - Math.random không phải nguồn ngẫu nhiên cho bí mật (V8 dùng xorshift128+,
 *     đủ mẫu đầu ra là đoán được các số sau). crypto.randomInt thì có.
 *   - Không đếm lần sai: throttle chặn 5 lần/phút mỗi IP, nhưng kẻ đoán có
 *     nhiều IP thì 10^6 mã trong 5 phút là chuyện của số máy, không phải của
 *     thiết kế. Mỗi OTP chỉ được sai 5 lần, lần thứ 5 là mã bị đốt.
 */
function dung(opts: { coTaiKhoan: boolean }) {
  const kho = new Map<string, unknown>();
  const cache = {
    get: jest.fn((k: string) => Promise.resolve(kho.get(k))),
    set: jest.fn((k: string, v: unknown) => {
      kho.set(k, v);
      return Promise.resolve();
    }),
    del: jest.fn((k: string) => {
      kho.delete(k);
      return Promise.resolve();
    }),
  };
  const thu: Array<{ html: string }> = [];
  const mailer = {
    sendMail: jest.fn((m: { html: string }) => {
      thu.push(m);
      return Promise.resolve();
    }),
  };
  const repo = {
    findOne: jest.fn(() =>
      Promise.resolve(
        opts.coTaiKhoan
          ? { id: 7, email: 'a@gmail.com', full_name: 'A' }
          : null,
      ),
    ),
    update: jest.fn(() => Promise.resolve()),
    increment: jest.fn(() => Promise.resolve()),
  };
  const usersService = {
    hashPassword: (p: string) => `hash:${p}`,
    register: jest.fn(() =>
      Promise.resolve({
        id: 8,
        email: 'a@gmail.com',
        full_name: 'A',
        role: 'buyer',
      }),
    ),
  };
  const svc = new AuthService(
    usersService as never,
    {} as never,
    { get: () => 'x' } as never,
    repo as never,
    cache as never,
    mailer as never,
  );
  const otp = () => /(\d{6})/.exec(thu[thu.length - 1]?.html ?? '')?.[1] ?? '';
  const otpSai = () => (otp() === '000000' ? '111111' : '000000');
  return { svc, repo, usersService, otp, otpSai };
}

describe('OTP sinh bằng crypto, không bằng Math.random', () => {
  afterEach(() => jest.restoreAllMocks());

  it('quên mật khẩu', async () => {
    const spy = jest.spyOn(Math, 'random');
    const { svc } = dung({ coTaiKhoan: true });
    await svc.sendForgotPasswordOtp('a@gmail.com');
    expect(spy).not.toHaveBeenCalled();
  });

  it('đăng ký', async () => {
    const spy = jest.spyOn(Math, 'random');
    const { svc } = dung({ coTaiKhoan: false });
    await svc.sendRegisterOtp('a@gmail.com', 'A');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('OTP bị đốt sau 5 lần sai', () => {
  it('quên mật khẩu: sai 5 lần thì mã đúng cũng không dùng được nữa', async () => {
    const { svc, repo, otp, otpSai } = dung({ coTaiKhoan: true });
    await svc.sendForgotPasswordOtp('a@gmail.com');
    const ma = otp();

    for (let i = 0; i < 5; i++) {
      await expect(
        svc.resetPassword('a@gmail.com', otpSai(), 'matkhaumoi1'),
      ).rejects.toThrow(BadRequestException);
    }
    await expect(
      svc.resetPassword('a@gmail.com', ma, 'matkhaumoi1'),
    ).rejects.toThrow(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('quên mật khẩu: sai 4 lần rồi đúng thì vẫn đặt lại được', async () => {
    const { svc, repo, otp, otpSai } = dung({ coTaiKhoan: true });
    await svc.sendForgotPasswordOtp('a@gmail.com');
    const ma = otp();

    for (let i = 0; i < 4; i++) {
      await expect(
        svc.resetPassword('a@gmail.com', otpSai(), 'matkhaumoi1'),
      ).rejects.toThrow(BadRequestException);
    }
    await svc.resetPassword('a@gmail.com', ma, 'matkhaumoi1');
    expect(repo.update).toHaveBeenCalled();
  });

  it('đăng ký: sai 5 lần thì mã đúng cũng không tạo được tài khoản', async () => {
    const { svc, usersService, otp, otpSai } = dung({ coTaiKhoan: false });
    await svc.sendRegisterOtp('a@gmail.com', 'A');
    const ma = otp();

    for (let i = 0; i < 5; i++) {
      await expect(
        svc.verifyRegisterOtp('a@gmail.com', otpSai(), 'matkhau123'),
      ).rejects.toThrow(BadRequestException);
    }
    await expect(
      svc.verifyRegisterOtp('a@gmail.com', ma, 'matkhau123'),
    ).rejects.toThrow(BadRequestException);
    expect(usersService.register).not.toHaveBeenCalled();
  });
});
