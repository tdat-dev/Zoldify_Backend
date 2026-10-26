import { AuthService } from './auth.service';

/**
 * POST /auth/forgot-password/send-otp là công cụ dò email.
 *
 * Email có tài khoản thì 200 "đã gửi OTP", không có thì 404 "Không tìm thấy
 * tài khoản với email này". Ai cũng hỏi được một danh sách email xem cái nào
 * là khách của sàn (rồi nhắm lừa đảo đúng người). Câu trả lời phải giống hệt
 * nhau trong hai trường hợp; chỉ chủ hộp thư biết là có thư hay không.
 */
function dung(user: { id: number; email: string } | null) {
  const mailer = { sendMail: jest.fn(() => Promise.resolve()) };
  const svc = new AuthService(
    {} as never,
    {} as never,
    { get: () => 'x' } as never,
    { findOne: jest.fn(() => Promise.resolve(user)) } as never,
    {
      get: jest.fn(() => Promise.resolve(undefined)),
      set: jest.fn(() => Promise.resolve()),
      del: jest.fn(() => Promise.resolve()),
    } as never,
    mailer as never,
  );
  return { svc, mailer };
}

describe('Quên mật khẩu không cho dò email nào đã đăng ký', () => {
  it('email không có tài khoản: trả đúng câu trả lời như khi có, không gửi thư', async () => {
    const coTaiKhoan = dung({ id: 7, email: 'a@gmail.com' });
    const khongCo = dung(null);

    const traLoiCo = await coTaiKhoan.svc.sendForgotPasswordOtp('a@gmail.com');
    const traLoiKhong = await khongCo.svc.sendForgotPasswordOtp('b@gmail.com');

    expect(traLoiKhong).toEqual(traLoiCo);
    expect(khongCo.mailer.sendMail).not.toHaveBeenCalled();
  });
});
