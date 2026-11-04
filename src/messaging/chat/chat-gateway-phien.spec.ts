import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from '@identity/auth/auth.service';
import { UserSession } from '@identity/auth/entities/user-session.entity';
import { User } from '@identity/users/entities/user.entity';
import { IUser } from '@identity/users/users.interface';
import { UsersService } from '@identity/users/users.service';
import { ChatGateway } from './chat.gateway';

/**
 * Socket chat phải theo đúng phiên, không chỉ theo token_version.
 *
 * Đăng xuất giờ chỉ thu hồi dòng user_sessions của máy đó và không tăng
 * token_version (thẻ Trello P2). Nếu gateway chỉ so token_version như trước thì
 * socket của máy đã đăng xuất sống mãi, vẫn gửi và nghe tin. Ba chỗ phải kiểm:
 * lúc nối, lúc gửi, và lượt quét 30 giây cho socket chỉ nghe. Socket của máy
 * khác thì phải sống tiếp.
 *
 * Chạy trên MySQL thật, phiên do AuthService phát thật.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

type SocketGia = {
  id: string;
  data: { user?: { id: number; sid?: string; token_version?: number } };
  handshake: { auth: { token: string }; query: Record<string, string> };
  emit: jest.Mock;
  join: jest.Mock;
  disconnect: jest.Mock;
};

describe('Socket chat theo phiên', () => {
  let ds: DataSource;
  let users: Repository<User>;
  let phiens: Repository<UserSession>;
  let svc: AuthService;
  const R = Math.floor(Math.random() * 100_000);
  const ID = 9_800_000 + R;
  const nguoi = {
    id: ID,
    full_name: 'Người dùng',
    email: `socket-${ID}@test.local`,
    role: 'buyer',
  };
  const jwt = new JwtService({
    secret: 'bi-mat-access-cho-test',
    signOptions: { expiresIn: '1d' },
  });
  const cauHinh: Record<string, string> = {
    JWT_REFRESH_TOKEN_SECRET: 'bi-mat-refresh-cho-test',
    JWT_REFRESH_EXPIRE: '7d',
  };
  const sidCua = (t: string) => jwt.decode<{ sid?: string }>(t).sid;

  /** Một gateway với `dangNoi` là các socket tiến trình này đang giữ. */
  function dungGateway(dangNoi: SocketGia[] = []) {
    const chatService = {
      sendMessage: jest.fn(() => Promise.resolve({ id: 1 })),
      getConversationById: jest.fn(() =>
        Promise.resolve({ id: 5, buyer: { id: ID }, seller: { id: 3 } }),
      ),
    };
    const gateway = new ChatGateway(
      chatService as never,
      jwt,
      { create: jest.fn(() => Promise.resolve()) } as never,
      users,
      phiens,
    );
    gateway.server = {
      to: () => ({ emit: jest.fn() }),
      emit: jest.fn(),
      in: () => ({ fetchSockets: () => Promise.resolve([]) }),
      fetchSockets: () => Promise.resolve(dangNoi),
      local: { fetchSockets: () => Promise.resolve(dangNoi) },
    } as never;
    return { gateway, chatService };
  }

  const socket = (id: string, token: string): SocketGia => ({
    id,
    data: {},
    handshake: { auth: { token }, query: {} },
    emit: jest.fn(),
    join: jest.fn(() => Promise.resolve()),
    disconnect: jest.fn(),
  });

  /** Đăng nhập rồi nối socket: socket đã qua handshake thật. */
  async function moiMay(gateway: ChatGateway, id: string) {
    const t = await svc.login(nguoi);
    const s = socket(id, t.access_token);
    await gateway.handleConnection(s as never);
    expect(s.disconnect).not.toHaveBeenCalled();
    return { t, s };
  }

  const dangXuat = (accessToken: string) =>
    svc.logout({ id: ID, sid: sidCua(accessToken) } as unknown as IUser);

  const tin = { conversationId: 5, content: 'Còn hàng không shop?' };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [User, UserSession],
      synchronize: true,
      logging: false,
    });
    await ds.initialize();
    users = ds.getRepository(User);
    phiens = ds.getRepository(UserSession);
    svc = new AuthService(
      new UsersService(users),
      jwt,
      { get: (k: string) => cauHinh[k] } as never,
      users,
      {
        get: () => Promise.resolve(undefined),
        set: () => Promise.resolve(),
      } as never,
      {} as never,
      phiens,
    );
  });

  beforeEach(async () => {
    await users.delete({ id: ID });
    await users.save({ ...nguoi, password: 'x', token_version: 0 } as User);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (ds?.isInitialized) {
      await users.delete({ id: ID });
      await ds.destroy();
    }
  });

  it('handshake: token của máy đã đăng xuất bị ngắt, máy khác nối được', async () => {
    const { gateway } = dungGateway();
    const a = await svc.login(nguoi);
    const b = await svc.login(nguoi);
    await dangXuat(b.access_token);

    const sa = socket('a', a.access_token);
    const sb = socket('b', b.access_token);
    await gateway.handleConnection(sa as never);
    await gateway.handleConnection(sb as never);

    expect(sa.disconnect).not.toHaveBeenCalled();
    expect(sa.data.user).toMatchObject({
      id: ID,
      sid: sidCua(a.access_token),
    });
    expect(sb.disconnect).toHaveBeenCalled();
    expect(sb.data.user).toBeUndefined();
  });

  it('handshake: phiên hết hạn bị ngắt', async () => {
    const { gateway } = dungGateway();
    const t = await svc.login(nguoi);
    await phiens.update(
      { id: sidCua(t.access_token) },
      { expires_at: new Date(Date.now() - 1_000) },
    );

    const s = socket('s', t.access_token);
    await gateway.handleConnection(s as never);

    expect(s.disconnect).toHaveBeenCalled();
  });

  it('gửi tin: socket của máy đã đăng xuất bị cắt, máy khác gửi được', async () => {
    const { gateway, chatService } = dungGateway();
    const a = await moiMay(gateway, 'a');
    const b = await moiMay(gateway, 'b');

    await dangXuat(b.t.access_token);
    await gateway.handleMessage(b.s as never, tin);

    expect(b.s.disconnect).toHaveBeenCalledWith(true);
    expect(chatService.sendMessage).not.toHaveBeenCalled();

    await gateway.handleMessage(a.s as never, tin);

    expect(a.s.disconnect).not.toHaveBeenCalled();
    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('vào phòng: socket của máy đã đăng xuất không vào được', async () => {
    const { gateway } = dungGateway();
    const { t, s } = await moiMay(gateway, 'b');

    await dangXuat(t.access_token);
    await gateway.handleJoinConversation(s as never, 5);

    expect(s.disconnect).toHaveBeenCalledWith(true);
    expect(s.join).not.toHaveBeenCalledWith('conv_5');
  });

  it('lượt quét: cắt socket chỉ nghe của máy đã đăng xuất, máy khác sống', async () => {
    const dangNoi: SocketGia[] = [];
    const { gateway } = dungGateway(dangNoi);
    const a = await moiMay(gateway, 'a');
    const b = await moiMay(gateway, 'b');
    dangNoi.push(a.s, b.s);

    await dangXuat(b.t.access_token);
    await gateway.quetPhienDaThuHoi();

    expect(b.s.disconnect).toHaveBeenCalledWith(true);
    expect(a.s.disconnect).not.toHaveBeenCalled();
  });

  it('lượt quét: phiên hết hạn hoặc mất dòng thì cắt', async () => {
    const dangNoi: SocketGia[] = [];
    const { gateway } = dungGateway(dangNoi);
    const hetHan = await moiMay(gateway, 'het-han');
    const matDong = await moiMay(gateway, 'mat-dong');
    dangNoi.push(hetHan.s, matDong.s);

    await phiens.update(
      { id: sidCua(hetHan.t.access_token) },
      { expires_at: new Date(Date.now() - 1_000) },
    );
    await phiens.delete({ id: sidCua(matDong.t.access_token) });
    await gateway.quetPhienDaThuHoi();

    expect(hetHan.s.disconnect).toHaveBeenCalledWith(true);
    expect(matDong.s.disconnect).toHaveBeenCalledWith(true);
  });

  it('lượt quét: một câu SELECT phiên cho cả lượt, không hỏi từng socket', async () => {
    const dangNoi: SocketGia[] = [];
    const { gateway } = dungGateway(dangNoi);
    for (const id of ['a', 'b', 'c', 'd']) {
      dangNoi.push((await moiMay(gateway, id)).s);
    }
    const find = jest.spyOn(phiens, 'find');
    const findOne = jest.spyOn(phiens, 'findOne');
    const findOneBy = jest.spyOn(phiens, 'findOneBy');

    await gateway.quetPhienDaThuHoi();

    expect(find).toHaveBeenCalledTimes(1);
    expect(findOne).not.toHaveBeenCalled();
    expect(findOneBy).not.toHaveBeenCalled();
  });

  it('token_version tăng vẫn cắt mọi socket có sid', async () => {
    const dangNoi: SocketGia[] = [];
    const { gateway } = dungGateway(dangNoi);
    const a = await moiMay(gateway, 'a');
    const b = await moiMay(gateway, 'b');
    dangNoi.push(a.s, b.s);

    await users.increment({ id: ID }, 'token_version', 1);
    await gateway.quetPhienDaThuHoi();

    expect(a.s.disconnect).toHaveBeenCalledWith(true);
    expect(b.s.disconnect).toHaveBeenCalledWith(true);
  });

  it('token phát trước bản vá (không sid): nối, gửi, qua lượt quét bình thường', async () => {
    const dangNoi: SocketGia[] = [];
    const { gateway, chatService } = dungGateway(dangNoi);
    const cu = jwt.sign({
      sub: ID,
      full_name: nguoi.full_name,
      email: nguoi.email,
      role: nguoi.role,
      token_version: 0,
    });
    const s = socket('cu', cu);
    await gateway.handleConnection(s as never);
    dangNoi.push(s);

    await gateway.handleMessage(s as never, tin);
    await gateway.quetPhienDaThuHoi();

    expect(s.disconnect).not.toHaveBeenCalled();
    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
  });
});
