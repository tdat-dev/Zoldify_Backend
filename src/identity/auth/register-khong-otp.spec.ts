import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';

/**
 * POST /auth/register tạo tài khoản NGAY, không cần OTP (B-05, M-04).
 *
 * Đó là nửa đầu của lỗ chiếm trước: ai cũng đăng ký được victim@gmail.com với
 * mật khẩu của mình, rồi chờ chủ thật tới. Luồng thật của cả ba client là
 * register/send-otp rồi register/verify-otp (web app/register/page.tsx, app
 * register-screen.tsx); hàm gọi /auth/register còn trong mã client nhưng không
 * màn hình nào dùng. Nên đóng route chứ không vá.
 *
 * Đọc thẳng metadata định tuyến của Nest: thứ quyết định route có tồn tại hay
 * không là decorator, không phải tên hàm.
 */
describe('Không còn đường đăng ký bỏ qua OTP', () => {
  const routes = () =>
    Object.getOwnPropertyNames(AuthController.prototype)
      .map((ten) => {
        const fn = Object.getOwnPropertyDescriptor(
          AuthController.prototype,
          ten,
        )?.value as object;
        return {
          path: Reflect.getMetadata(PATH_METADATA, fn) as string | undefined,
          method: Reflect.getMetadata(METHOD_METADATA, fn) as
            | RequestMethod
            | undefined,
        };
      })
      .filter((r) => r.path !== undefined);

  it('AuthController không có POST /auth/register', () => {
    const coRegister = routes().some(
      (r) => r.method === RequestMethod.POST && r.path === 'register',
    );
    expect(coRegister).toBe(false);
  });

  it('luồng OTP vẫn còn nguyên', () => {
    const paths = routes().map((r) => r.path);
    expect(paths).toEqual(
      expect.arrayContaining(['register/send-otp', 'register/verify-otp']),
    );
  });
});
