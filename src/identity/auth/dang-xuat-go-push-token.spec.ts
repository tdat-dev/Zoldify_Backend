import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import * as authDto from './dto/auth.entity';
import { IUser } from '@identity/users/users.interface';
import { UserRole } from '@identity/users/entities/user.entity';

/**
 * Đăng xuất phải gỡ được push token của thiết bị NGAY TRONG request đó.
 *
 * Tới 27/10 `POST /auth/logout` chỉ tăng `token_version`. Muốn gỡ token FCM thì
 * app phải gọi thêm `DELETE /notifications/push-token`, mà gọi TRƯỚC thì chưa
 * chắc đăng xuất thành công, gọi SAU thì JWT đã chết (token_version vừa tăng)
 * nên nhận 401. Kết quả: máy đã đăng xuất vẫn nhận thông báo đơn hàng của tài
 * khoản cũ, kể cả khi người khác đăng nhập trên máy đó.
 *
 * Bài kiểm này đỏ cho tới khi logout nhận `push_token` tuỳ chọn và xoá đúng
 * dòng của CHÍNH người đang đăng xuất.
 */
describe('Đăng xuất gỡ push token', () => {
  const user: IUser = {
    id: 7,
    email: 'a@t.local',
    full_name: 'A',
    role: UserRole.BUYER,
    avatar: '',
  };

  function dungService(queryLoi = false) {
    const cauLenh: Array<{ sql: string; params: unknown[] }> = [];
    const userRepository = {
      increment: () => Promise.resolve(),
      manager: {
        query: (sql: string, params: unknown[]) => {
          cauLenh.push({ sql, params });
          return queryLoi
            ? Promise.reject(new Error('MySQL chập'))
            : Promise.resolve({ affectedRows: 1 });
        },
      },
    };
    const service = new AuthService(
      { updateUserToken: () => Promise.resolve() } as never,
      {} as never,
      {} as never,
      userRepository as never,
      {} as never,
      {} as never,
    );
    const logout = service.logout.bind(service) as (
      u: IUser,
      token?: string,
    ) => Promise<unknown>;
    return { logout, cauLenh };
  }

  it('có push_token thì xoá đúng token của chính người đăng xuất', async () => {
    const { logout, cauLenh } = dungService();

    await logout(user, 'fcm-token-may-nay');

    const xoa = cauLenh.filter((c) =>
      /DELETE\s+FROM\s+push_tokens/i.test(c.sql),
    );
    expect(xoa).toHaveLength(1);
    expect(xoa[0].sql).toMatch(/user_id\s*=\s*\?/i);
    expect(xoa[0].params).toEqual(['fcm-token-may-nay', 7]);
  });

  it('không gửi push_token thì không đụng bảng push_tokens', async () => {
    const { logout, cauLenh } = dungService();
    await logout(user);
    expect(cauLenh).toHaveLength(0);
  });

  it('xoá token lỗi thì vẫn đăng xuất thành công', async () => {
    const { logout } = dungService(true);
    await expect(logout(user, 'tok')).resolves.toBeTruthy();
  });

  it('controller chuyển push_token trong body xuống service', async () => {
    const goi: unknown[][] = [];
    const service = {
      logout: (...a: unknown[]) => {
        goi.push(a);
        return Promise.resolve({ message: 'ok' });
      },
    };
    const controller = new AuthController(
      service as never,
      {} as never,
      {} as never,
    );
    const logout = controller.logout.bind(controller) as (
      u: IUser,
      body: unknown,
    ) => Promise<unknown>;

    await logout(user, { push_token: 'tok-1' });

    expect(goi).toEqual([[user, 'tok-1']]);
  });

  it('DTO nhận body rỗng, chặn push_token quá dài hoặc sai kiểu', async () => {
    const Dto = (authDto as Record<string, unknown>).LogoutDto as
      | (new () => object)
      | undefined;
    expect(Dto).toBeDefined();
    if (!Dto) return;

    const loi = async (body: object) =>
      (await validate(plainToInstance(Dto, body))).length;

    expect(await loi({})).toBe(0);
    expect(await loi({ push_token: 'abc' })).toBe(0);
    // Cột push_tokens.token là varchar(512).
    expect(await loi({ push_token: 'x'.repeat(513) })).toBeGreaterThan(0);
    expect(await loi({ push_token: 123 })).toBeGreaterThan(0);
  });
});
