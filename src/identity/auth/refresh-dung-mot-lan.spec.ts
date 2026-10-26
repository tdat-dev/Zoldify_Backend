import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { UsersService } from '@identity/users/users.service';
import { User } from '@identity/users/entities/user.entity';

/**
 * Refresh token dùng lại được vô hạn lần.
 *
 * refreshToken() chỉ kiểm chữ ký và token_version. Cột users.refresh_token có
 * ghi token mới mỗi lần, nhưng KHÔNG ai đọc lại để so. Hậu quả:
 *   - refresh token bị lộ (log, thiết bị cũ, bản sao lưu) dùng được tới hết hạn
 *     (JWT_REFRESH_EXPIRE, một tuần), song song với chủ thật, và không có cách
 *     nào phát hiện;
 *   - cột lưu nguyên token: ai đọc được bảng users là cầm được phiên của mọi
 *     người (cột này từng lộ ra qua GET /products, xem user.entity.ts).
 * Đúng phải là: lưu HASH, so khi làm mới, xoay vòng (token cũ chết ngay khi
 * token mới ra đời), và gặp token cũ quay lại thì coi là bị trộm: tăng
 * token_version, đá mọi phiên.
 *
 * Chạy trên MySQL thật vì "chỉ dùng một lần" phải đúng ở câu UPDATE có điều
 * kiện, kể cả khi hai request làm mới chạy cùng lúc.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Refresh token chỉ dùng được một lần', () => {
  let ds: DataSource;
  let svc: AuthService;
  const R = Math.floor(Math.random() * 100_000);
  const ID = 9_500_000 + R;
  const nguoi = {
    id: ID,
    full_name: 'Người dùng',
    email: `refresh-${ID}@test.local`,
    role: 'buyer',
  };

  const cotRefresh = async () => {
    const rows = await ds.query<Array<{ refresh_token: string | null }>>(
      'SELECT refresh_token FROM users WHERE id = ?',
      [ID],
    );
    return rows[0]?.refresh_token ?? null;
  };
  const tokenVersion = async () => {
    const u = await ds.getRepository(User).findOne({ where: { id: ID } });
    return u?.token_version;
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User],
      synchronize: true,
      logging: false,
    });
    try {
      await ds.initialize();
    } catch (err) {
      throw new Error(
        `Không kết nối được MySQL cho test tại ${TEST_DB.host}:${TEST_DB.port}. ` +
          `Chạy: npm run test:db. Lỗi gốc: ${(err as Error).message}`,
      );
    }
    const cauHinh: Record<string, string> = {
      JWT_REFRESH_TOKEN_SECRET: 'bi-mat-refresh-cho-test',
      JWT_REFRESH_EXPIRE: '7d',
    };
    svc = new AuthService(
      new UsersService(ds.getRepository(User)),
      new JwtService({ secret: 'bi-mat-access-cho-test' }),
      { get: (k: string) => cauHinh[k] } as never,
      ds.getRepository(User),
      {} as never,
      {} as never,
    );
  });

  beforeEach(async () => {
    await ds.getRepository(User).delete({ id: ID });
    await ds.getRepository(User).save({
      ...nguoi,
      password: 'x',
      token_version: 0,
    } as User);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(User).delete({ id: ID });
      await ds.destroy();
    }
  });

  it('DB lưu hash của refresh token, không lưu nguyên token', async () => {
    const t = await svc.login(nguoi);

    const daLuu = await cotRefresh();
    expect(daLuu).not.toBe(t.refresh_token);
    expect(daLuu).toBe(sha256(t.refresh_token));
  });

  it('dùng lại refresh token đã đổi thì bị từ chối', async () => {
    const t = await svc.login(nguoi);
    await svc.refreshToken(t.refresh_token);

    await expect(svc.refreshToken(t.refresh_token)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('gặp token cũ quay lại: tăng token_version, token mới nhất cũng chết', async () => {
    const t = await svc.login(nguoi);
    const moi = await svc.refreshToken(t.refresh_token);
    const truoc = await tokenVersion();

    await expect(svc.refreshToken(t.refresh_token)).rejects.toThrow(
      BadRequestException,
    );

    expect(await tokenVersion()).toBe((truoc ?? 0) + 1);
    await expect(svc.refreshToken(moi.refresh_token)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('token mới nhất làm mới được, và mỗi lần ra một token khác', async () => {
    const t = await svc.login(nguoi);
    const r1 = await svc.refreshToken(t.refresh_token);
    const r2 = await svc.refreshToken(r1.refresh_token);

    expect(r2.access_token).toBeTruthy();
    expect(
      new Set([t.refresh_token, r1.refresh_token, r2.refresh_token]).size,
    ).toBe(3);
  });

  it('hai request làm mới cùng lúc bằng một token: đúng một cái thành công', async () => {
    const t = await svc.login(nguoi);

    const kq = await Promise.allSettled([
      svc.refreshToken(t.refresh_token),
      svc.refreshToken(t.refresh_token),
    ]);

    expect(kq.filter((k) => k.status === 'fulfilled')).toHaveLength(1);
  });
});
