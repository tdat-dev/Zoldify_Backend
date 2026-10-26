import { AuthService } from './auth.service';

/**
 * Quên mật khẩu gửi OTP tới địa chỉ GÕ VÀO, và khoá cache theo chuỗi gõ vào.
 *
 * Đây là nửa thứ hai của lỗ email giả dạng: findOne theo email chạy trên
 * collation không phân biệt hoa thường và dấu, nên "chuỗi gõ vào" và "email của
 * tài khoản tìm được" có thể là HAI địa chỉ khác nhau. OTP là bằng chứng sở hữu
 * hộp thư của TÀI KHOẢN, nên phải tới đúng địa chỉ trong DB; cache khoá theo id
 * tài khoản để mọi cách gõ khác nhau của cùng một email đều chỉ tới một OTP.
 * Lớp chuẩn hoá ASCII chặn được ca IDN, lớp này chặn mọi ca còn lại mà
 * collation coi là "bằng nhau" nhưng máy chủ mail thì không.
 */
function dung() {
  const user = {
    id: 7,
    email: 'Victim@Gmail.com',
    full_name: 'Nạn nhân',
    token_version: 0,
  };
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
  const thu: Array<{ to: string; html: string }> = [];
  const mailer = {
    sendMail: jest.fn((m: { to: string; html: string }) => {
      thu.push(m);
      return Promise.resolve();
    }),
  };
  const repo = {
    findOne: jest.fn(() => Promise.resolve(user)),
    update: jest.fn(() => Promise.resolve()),
    increment: jest.fn(() => Promise.resolve()),
  };
  const svc = new AuthService(
    { hashPassword: (p: string) => `hash:${p}` } as never,
    {} as never,
    { get: () => 'x' } as never,
    repo as never,
    cache as never,
    mailer as never,
  );
  const otpTrongThu = () => /(\d{6})/.exec(thu[0]?.html ?? '')?.[1] ?? '';
  return { svc, cache, thu, repo, otpTrongThu };
}

describe('Quên mật khẩu: OTP tới địa chỉ trong DB, cache theo id tài khoản', () => {
  it('OTP gửi tới email của tài khoản trong DB, không tới chuỗi gõ vào', async () => {
    const { svc, thu } = dung();

    await svc.sendForgotPasswordOtp('victim@gmail.com');

    expect(thu).toHaveLength(1);
    expect(thu[0].to).toBe('Victim@Gmail.com');
  });

  it('cache khoá theo id tài khoản', async () => {
    const { svc, cache } = dung();

    await svc.sendForgotPasswordOtp('victim@gmail.com');

    const khoa = (cache.set.mock.calls[0] as unknown[])[0];
    expect(khoa).toBe('forgot_otp_7');
  });

  it('đặt lại mật khẩu tìm OTP theo id, gõ email khác hoa thường vẫn khớp', async () => {
    const { svc, repo, otpTrongThu } = dung();
    await svc.sendForgotPasswordOtp('victim@gmail.com');

    await svc.resetPassword('VICTIM@gmail.com', otpTrongThu(), 'matkhaumoi1');

    expect(repo.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ password: 'hash:matkhaumoi1' }),
    );
  });
});
