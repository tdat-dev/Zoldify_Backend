import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './passport/jwt.strategy';
import { AuthService } from './auth.service';
import { AdminService } from '@ops/admin/admin.service';
import { ChatGateway } from '@messaging/chat/chat.gateway';

/**
 * Bài kiểm cho một lỗ hổng đã bịt (audit B-04, 28/09).
 *
 * Admin bấm "Khoá tài khoản" chỉ đổi cột `is_locked`; đăng nhập, JwtStrategy
 * và socket chat không hề đọc cột đó. Người bị khoá (ví dụ kẻ lừa đảo) vẫn
 * đăng nhập, đăng bán, chat và rút tiền như thường.
 *
 * Bốn chỗ phải chặn: phát token mới, mọi request HTTP, phiên đang có (thu hồi
 * bằng token_version), và kết nối socket.
 */
interface FakeUser {
  id: number;
  role: string;
  is_locked: boolean;
  token_version: number;
}

interface FakeClient {
  id: string;
  data: { user?: { id: number } };
  handshake: { auth: { token: string }; query: Record<string, string> };
  disconnect: jest.Mock;
}

const lockedUser: FakeUser = {
  id: 5,
  role: 'buyer',
  is_locked: true,
  token_version: 2,
};
const activeUser: FakeUser = { ...lockedUser, is_locked: false };

const repoReturning = (user: FakeUser) => ({
  findOne: () => Promise.resolve(user),
});

describe('B-04: tài khoản bị khoá không dùng được hệ thống', () => {
  it('JwtStrategy từ chối request của tài khoản bị khoá', async () => {
    const strategy = new JwtStrategy(
      { get: () => 'test-secret' } as never,
      repoReturning(lockedUser) as never,
    );
    await expect(
      strategy.validate({ sub: 5, token_version: 2, role: 'buyer' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('JwtStrategy vẫn cho tài khoản bình thường qua', async () => {
    const strategy = new JwtStrategy(
      { get: () => 'test-secret' } as never,
      repoReturning(activeUser) as never,
    );
    await expect(
      strategy.validate({ sub: 5, token_version: 2, role: 'buyer' }),
    ).resolves.toMatchObject({ id: 5 });
  });

  it('login() không phát token cho tài khoản bị khoá', async () => {
    const sign = jest.fn(() => 'jwt');
    const service = new AuthService(
      { updateUserToken: jest.fn() } as never,
      { sign } as never,
      { get: () => '1d' } as never,
      repoReturning(lockedUser) as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.login({ id: 5, email: 'a@b.c', full_name: 'x', role: 'buyer' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(sign).not.toHaveBeenCalled();
  });

  it('khoá tài khoản thì tăng token_version để thu hồi phiên đang có', async () => {
    const user: FakeUser = { ...activeUser };
    const service = new AdminService(
      {
        findOne: () => Promise.resolve(user),
        save: (u: FakeUser) => Promise.resolve(u),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.toggleUserLock(5);
    expect(user.is_locked).toBe(true);
    expect(user.token_version).toBe(3);
  });

  describe('socket chat', () => {
    const connect = async (
      dbUser: FakeUser,
      tokenVersion = 2,
    ): Promise<FakeClient> => {
      const gateway = new ChatGateway(
        {} as never,
        { verify: () => ({ sub: 5, token_version: tokenVersion }) } as never,
        {} as never,
        {
          findOne: () => Promise.resolve(dbUser),
          update: () => Promise.resolve(),
        } as never,
      );
      Object.assign(gateway, { server: { emit: jest.fn() } });
      const client: FakeClient = {
        id: 's1',
        data: {},
        handshake: { auth: { token: 't' }, query: {} },
        disconnect: jest.fn(),
      };
      await gateway.handleConnection(client as never);
      return client;
    };

    it('tài khoản bị khoá bị ngắt kết nối', async () => {
      const client = await connect(lockedUser);
      expect(client.disconnect).toHaveBeenCalled();
      expect(client.data.user).toBeUndefined();
    });

    it('token đã bị thu hồi (token_version cũ) bị ngắt kết nối', async () => {
      const client = await connect(activeUser, 1);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('tài khoản bình thường kết nối được', async () => {
      const client = await connect(activeUser);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toMatchObject({ id: 5 });
    });
  });
});
