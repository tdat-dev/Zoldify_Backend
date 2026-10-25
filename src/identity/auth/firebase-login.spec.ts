import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthController } from './auth.controller';
import { FirebaseService } from '@messaging/firebase/firebase.service';

/**
 * POST /auth/firebase: chiếm tài khoản qua đăng nhập Firebase (B-05 mở rộng).
 *
 * Bản cũ lấy `decoded.email` rồi nối thẳng vào `users.email` trùng, không hỏi:
 *   - email đó Firebase đã XÁC MINH chưa (`email_verified`),
 *   - token đến từ nhà cung cấp nào (`firebase.sign_in_provider`). Project
 *     Firebase bật thêm đăng nhập email/mật khẩu là ai cũng tự tạo được tài
 *     khoản Firebase mang email của người khác, chưa xác minh, rồi đổi lấy
 *     JWT của chủ thật bên Zoldify,
 *   - token không có email thì rơi về `phone_number: ''`, tức `findOne` theo
 *     số điện thoại RỖNG: trúng bất kỳ ai chưa khai số.
 *
 * Và tài khoản Zoldify có sẵn mà CHƯA xác minh email (tạo qua đăng ký không
 * OTP) thì đăng nhập Google vẫn nối vào, trong khi kẻ đăng ký trước vẫn giữ
 * mật khẩu của nó.
 *
 * Mock `firebase-admin` thay vì mock FirebaseService: lỗ nằm ở chỗ service
 * vứt bỏ `email_verified` và `sign_in_provider` trước khi controller kịp nhìn,
 * nên phải chạy mã thật của cả hai.
 */
const verifyIdToken = jest.fn();
jest.mock('firebase-admin', () => ({
  apps: [],
  auth: () => ({ verifyIdToken }),
}));

type Decoded = {
  uid: string;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  name?: string;
  picture?: string;
  firebase: { sign_in_provider: string };
};

const googleToken = (over: Partial<Decoded> = {}): Decoded => ({
  uid: 'uid-1',
  email: 'nan-nhan@gmail.com',
  email_verified: true,
  name: 'Nạn Nhân',
  picture: '',
  firebase: { sign_in_provider: 'google.com' },
  ...over,
});

type DongUser = {
  id: number;
  email: string;
  email_verified: boolean;
  avatar?: string;
};

function dung(opts: { coSan?: DongUser | null } = {}) {
  const firebase = new FirebaseService();
  (firebase as unknown as { initialized: boolean }).initialized = true;

  const userRepository = {
    findOne: jest.fn(() => Promise.resolve(opts.coSan ?? null)),
    create: jest.fn((x: Partial<DongUser>) => x),
    save: jest.fn((x: Partial<DongUser>) => Promise.resolve({ id: 99, ...x })),
    update: jest.fn(() => Promise.resolve()),
  };
  const authService = {
    login: jest.fn((u: { id: number }) =>
      Promise.resolve({ access_token: `jwt-${u.id}` }),
    ),
  };
  const controller = new AuthController(
    authService as never,
    firebase,
    userRepository as never,
  );
  return { controller, userRepository, authService };
}

describe('POST /auth/firebase không cho chiếm tài khoản', () => {
  beforeEach(() => verifyIdToken.mockReset());

  it('token Google đã xác minh, email mới: tạo tài khoản email_verified = true', async () => {
    verifyIdToken.mockResolvedValue(googleToken());
    const { controller, userRepository, authService } = dung();

    await controller.firebaseLogin({ idToken: 'tok' } as never);

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'nan-nhan@gmail.com',
        email_verified: true,
      }),
    );
    expect(authService.login).toHaveBeenCalled();
  });

  it('email chưa được Firebase xác minh thì bị từ chối', async () => {
    verifyIdToken.mockResolvedValue(googleToken({ email_verified: false }));
    const { controller, authService } = dung({
      coSan: { id: 7, email: 'nan-nhan@gmail.com', email_verified: true },
    });

    await expect(
      controller.firebaseLogin({ idToken: 'tok' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('token không phải Google (email/mật khẩu của Firebase) bị từ chối', async () => {
    verifyIdToken.mockResolvedValue(
      googleToken({ firebase: { sign_in_provider: 'password' } }),
    );
    const { controller, authService } = dung({
      coSan: { id: 7, email: 'nan-nhan@gmail.com', email_verified: true },
    });

    await expect(
      controller.firebaseLogin({ idToken: 'tok' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('token không có email thì bị từ chối, không tra theo số điện thoại rỗng', async () => {
    verifyIdToken.mockResolvedValue(
      googleToken({ email: undefined, phone_number: undefined }),
    );
    const { controller, userRepository, authService } = dung({
      coSan: { id: 7, email: 'ai-do@gmail.com', email_verified: true },
    });

    await expect(
      controller.firebaseLogin({ idToken: 'tok' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('không tự nối vào tài khoản có sẵn mà email CHƯA xác minh', async () => {
    verifyIdToken.mockResolvedValue(googleToken());
    const { controller, authService } = dung({
      coSan: { id: 7, email: 'nan-nhan@gmail.com', email_verified: false },
    });

    await expect(
      controller.firebaseLogin({ idToken: 'tok' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('tài khoản có sẵn đã xác minh email thì đăng nhập bình thường', async () => {
    verifyIdToken.mockResolvedValue(googleToken());
    const { controller, authService } = dung({
      coSan: { id: 7, email: 'nan-nhan@gmail.com', email_verified: true },
    });

    await controller.firebaseLogin({ idToken: 'tok' } as never);

    expect(authService.login).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
    );
  });
});

describe('POST /auth/firebase có DTO và giới hạn nhịp như các route auth khác', () => {
  it('body được kiểm bằng DTO: idToken rỗng bị từ chối', async () => {
    const kieu = Reflect.getMetadata(
      'design:paramtypes',
      AuthController.prototype,
      'firebaseLogin',
    ) as Array<new () => object>;
    expect(kieu[0]).not.toBe(String);

    const loi = await validate(plainToInstance(kieu[0], { idToken: '' }));
    expect(loi.length).toBeGreaterThan(0);
  });

  it('có @Throttle riêng', () => {
    // Đọc qua descriptor để không tách phương thức khỏi this (unbound-method).
    const handler = Object.getOwnPropertyDescriptor(
      AuthController.prototype,
      'firebaseLogin',
    )?.value as object;
    const han = Reflect.getMetadata('THROTTLER:LIMITshort', handler) as
      | number
      | undefined;
    expect(han).toBeDefined();
  });
});
