import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import {
  ResetPasswordDto,
  SendOtpDto,
  SendRegisterOtpDto,
  VerifyRegisterOtpDto,
} from './dto/auth.entity';
import { LoginUserDto } from '@identity/users/dto/create-user.dto';

/**
 * Chiếm tài khoản bằng email giả dạng (IDN look-alike).
 *
 * users.email dùng collation utf8mb4_unicode_ci (bỏ dấu, bỏ hoa thường), còn
 * @IsEmail nhận tên miền Unicode. Kẻ xấu sở hữu gmaïl.com gọi quên mật khẩu với
 * victim@gmaïl.com: findOne khớp victim@gmail.com, OTP gửi tới địa chỉ GÕ VÀO
 * (victim@xn--gmal-7pa.com, hộp thư kẻ xấu), đặt lại mật khẩu là xong.
 *
 * Phần này đo lớp thứ nhất: mọi cửa vào nhận email phải chuẩn hoá (trim, NFKC,
 * chữ thường) và từ chối email có ký tự ngoài ASCII, ở DTO lẫn ở service (đăng
 * nhập đi qua LocalStrategy, chạy TRƯỚC ValidationPipe nên DTO không cứu được).
 */
const IDN = 'victim@gmaïl.com';

const DTO: Array<[string, new () => object, Record<string, string>]> = [
  ['SendOtpDto', SendOtpDto, {}],
  [
    'ResetPasswordDto',
    ResetPasswordDto,
    { otp: '123456', newPassword: 'matkhau123' },
  ],
  ['SendRegisterOtpDto', SendRegisterOtpDto, { full_name: 'A' }],
  [
    'VerifyRegisterOtpDto',
    VerifyRegisterOtpDto,
    { otp: '123456', password: 'matkhau123' },
  ],
  ['LoginUserDto', LoginUserDto, { password: 'matkhau123' }],
];

// coTaiKhoan=false: chưa ai đăng ký email này (đường đăng ký). otpDaLuu: giá
// trị cache trả về, đúng như OTP người dùng sẽ gõ, để ca đỏ không đỏ nhầm vì
// sai OTP mà đỏ vì đi trót lọt tới cuối.
function dungService(opts: { coTaiKhoan?: boolean; otpDaLuu?: unknown } = {}) {
  const repo = {
    findOne: jest.fn(() =>
      Promise.resolve(
        opts.coTaiKhoan === false ? null : { id: 7, email: 'victim@gmail.com' },
      ),
    ),
    update: jest.fn(() => Promise.resolve()),
    increment: jest.fn(() => Promise.resolve()),
  };
  const usersService = {
    findOneByEmail: jest.fn(() => Promise.resolve(null)),
    register: jest.fn(),
  };
  const cache = {
    get: jest.fn(() =>
      Promise.resolve(opts.otpDaLuu ?? { otp: '123456', full_name: 'A' }),
    ),
    set: jest.fn(() => Promise.resolve()),
    del: jest.fn(() => Promise.resolve()),
  };
  const mailer = { sendMail: jest.fn(() => Promise.resolve()) };
  const svc = new AuthService(
    usersService as never,
    {} as never,
    { get: () => undefined } as never,
    repo as never,
    cache as never,
    mailer as never,
  );
  return { svc, repo, usersService, mailer };
}

describe('Email giả dạng bị chặn ở DTO', () => {
  it.each(DTO)(
    '%s từ chối email có ký tự ngoài ASCII',
    async (_ten, Lop, them) => {
      const loi = await validate(plainToInstance(Lop, { ...them, email: IDN }));
      expect(loi.map((e) => e.property)).toContain('email');
    },
  );

  it.each(DTO)(
    '%s chuẩn hoá khoảng trắng và chữ hoa',
    async (_ten, Lop, them) => {
      const dto = plainToInstance(Lop, {
        ...them,
        email: '  Victim@Gmail.COM ',
      }) as {
        email: string;
      };
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.email).toBe('victim@gmail.com');
    },
  );
});

describe('Email giả dạng bị chặn ở service', () => {
  it('quên mật khẩu: không tra DB, không gửi mail', async () => {
    const { svc, repo, mailer } = dungService();
    await expect(svc.sendForgotPasswordOtp(IDN)).rejects.toThrow(
      BadRequestException,
    );
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('đặt lại mật khẩu: bị từ chối, không đổi mật khẩu', async () => {
    const { svc, repo } = dungService({ otpDaLuu: '123456' });
    await expect(
      svc.resetPassword(IDN, '123456', 'matkhau123'),
    ).rejects.toThrow(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('đăng ký gửi OTP: không gửi mail', async () => {
    const { svc, mailer } = dungService({ coTaiKhoan: false });
    await expect(svc.sendRegisterOtp(IDN, 'A')).rejects.toThrow(
      BadRequestException,
    );
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('đăng ký xác nhận OTP: không tạo tài khoản', async () => {
    const { svc, usersService } = dungService();
    await expect(
      svc.verifyRegisterOtp(IDN, '123456', 'matkhau123'),
    ).rejects.toThrow(BadRequestException);
    expect(usersService.register).not.toHaveBeenCalled();
  });

  it('đăng nhập (LocalStrategy gọi thẳng, không qua DTO): không tra DB', async () => {
    const { svc, usersService } = dungService();
    await expect(svc.validateUser(IDN, 'matkhau123')).rejects.toThrow(
      BadRequestException,
    );
    expect(usersService.findOneByEmail).not.toHaveBeenCalled();
  });
});
