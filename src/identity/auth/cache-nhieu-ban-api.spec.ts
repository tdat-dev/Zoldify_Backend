import { ConflictException } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { FirebaseModule } from '@messaging/firebase/firebase.module';
import { FirebaseService } from '@messaging/firebase/firebase.service';
import { cacheConfig } from '../../common/cache.config';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { UserSession } from './entities/user-session.entity';

/**
 * Trạng thái của AuthService phải thấy được từ mọi bản api.
 *
 * AuthModule từng tự khai CacheModule.register() riêng, che mất cache Redis
 * toàn cục, nên mỗi tiến trình giữ OTP và dấu ân hạn trong RAM của mình. Chạy ba
 * bản api sau cân bằng tải thì request sau rơi vào bản khác 2/3 số lần. Đo trên
 * staging ngày 05/11: gửi lại refresh token trong ân hạn chỉ được 409 đúng 3/9
 * lần, 6 lần còn lại bị coi là trộm token và đá mọi phiên.
 *
 * Bài này dựng HAI AuthModule thật trên cùng một Redis thật, không mock cache:
 * mock thì hai bản dùng chung Map và bài luôn xanh, đúng thứ cần chứng minh.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};
const TEST_REDIS = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380';

jest.setTimeout(60_000);

describe('Cache của AuthService dùng chung giữa các bản api', () => {
  const R = Math.floor(Math.random() * 100_000);
  const thu: string[] = [];
  const mailGia = {
    sendMail: ({ html }: { html: string }) => {
      thu.push(html);
      return Promise.resolve();
    },
  };
  const otpMoiNhat = () => /\b\d{6}\b/.exec(thu[thu.length - 1])?.[0] ?? '';
  const otpSai = (otp: string) => (otp === '000000' ? '000001' : '000000');

  const dungBanApi = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'bi-mat-access-cho-test',
              JWT_REFRESH_TOKEN_SECRET: 'bi-mat-refresh-cho-test',
              JWT_REFRESH_EXPIRE: '7d',
            }),
          ],
        }),
        // Đúng cấu hình cache production, cùng cách AppModule khai.
        CacheModule.registerAsync({ isGlobal: true, useFactory: cacheConfig }),
        TypeOrmModule.forRoot({
          type: 'mysql',
          ...TEST_DB,
          entities: [User, UserSession],
          synchronize: true,
          logging: false,
        }),
        FirebaseModule,
        AuthModule,
      ],
    })
      .overrideProvider(MailerService)
      .useValue(mailGia)
      .overrideProvider(FirebaseService)
      .useValue({})
      .compile();

  let banA: TestingModule;
  let banB: TestingModule;
  let a: AuthService;
  let b: AuthService;
  let ds: DataSource;
  const redisCu = process.env.REDIS_URL;

  beforeAll(async () => {
    process.env.REDIS_URL = TEST_REDIS;
    banA = await dungBanApi();
    banB = await dungBanApi();
    a = banA.get(AuthService);
    b = banB.get(AuthService);
    ds = banA.get<DataSource>(getDataSourceToken());
  });

  afterAll(async () => {
    await ds?.query(`DELETE FROM users WHERE email LIKE ?`, [
      `%-${R}@test.local`,
    ]);
    await banA?.close();
    await banB?.close();
    process.env.REDIS_URL = redisCu;
  });

  it('OTP đăng ký phát ở bản A xác minh được ở bản B', async () => {
    const email = `dang-ky-${R}@test.local`;
    await a.sendRegisterOtp(email, 'Người thử');

    const tao = await b.verifyRegisterOtp(email, otpMoiNhat(), 'MatKhau@123');

    expect(tao.email).toBe(email);
  });

  it('đếm lần đoán sai cộng dồn giữa hai bản, không được đoán gấp ba', async () => {
    const email = `doan-sai-${R}@test.local`;
    await a.sendRegisterOtp(email, 'Người thử');
    const sai = otpSai(otpMoiNhat());

    for (const ban of [a, b, a, b]) {
      await expect(
        ban.verifyRegisterOtp(email, sai, 'MatKhau@123'),
      ).rejects.toThrow('Mã OTP không chính xác');
    }

    await expect(
      b.verifyRegisterOtp(email, sai, 'MatKhau@123'),
    ).rejects.toThrow('Nhập sai mã OTP quá 5 lần');
  });

  it('gửi lại refresh token ở bản khác trong ân hạn: 409, không đá phiên', async () => {
    const email = `an-han-${R}@test.local`;
    await a.sendRegisterOtp(email, 'Người thử');
    const tao = await a.verifyRegisterOtp(email, otpMoiNhat(), 'MatKhau@123');
    const phien = await a.login({
      id: tao.id,
      full_name: tao.full_name,
      email: tao.email,
      role: tao.role,
    });

    await a.refreshToken(phien.refresh_token);

    await expect(b.refreshToken(phien.refresh_token)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const rows = await ds.query<Array<{ token_version: number }>>(
      'SELECT token_version FROM users WHERE id = ?',
      [tao.id],
    );
    expect(rows[0].token_version).toBe(0);
  });
});
