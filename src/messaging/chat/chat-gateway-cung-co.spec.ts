import { ChatGateway } from './chat.gateway';

/**
 * Ba chỗ hở còn lại của socket chat.
 *
 *   1. Giới hạn nhịp gửi tin nằm trong client.data, tức theo TỪNG SOCKET: mở
 *      thêm socket (hoặc ngắt rồi nối lại) là có hạn mức mới.
 *   2. Không giới hạn số kết nối của một người: một token mở được hàng nghìn
 *      socket, mỗi cái giữ một kết nối và một lần UPDATE last_seen.
 *   3. Phiên đã bị thu hồi (khoá tài khoản, đăng xuất, đổi vai trò, đổi/đặt lại
 *      mật khẩu, refresh bị dùng lại: tất cả đều tăng token_version) vẫn giữ
 *      socket đang mở: vẫn gửi tin, vẫn nghe tin trong các phòng đã vào, tới khi
 *      tự ngắt. handleConnection chỉ kiểm token_version MỘT LẦN, lúc nối.
 */
type SocketGia = {
  id: string;
  data: {
    user?: { id: number; full_name: string; token_version?: number };
  };
  handshake: { auth: { token?: string }; query: Record<string, string> };
  emit: jest.Mock;
  join: jest.Mock;
  disconnect: jest.Mock;
};

function socket(id: string, userId = 2, tokenVersion = 0): SocketGia {
  return {
    id,
    data: {
      user: { id: userId, full_name: 'Người mua', token_version: tokenVersion },
    },
    handshake: { auth: { token: 'tok' }, query: {} },
    emit: jest.fn(),
    join: jest.fn(),
    disconnect: jest.fn(),
  };
}

function dung(opts: { tokenVersionDb?: number; soSocketDangMo?: number } = {}) {
  const chatService = {
    sendMessage: jest.fn(() => Promise.resolve({ id: 1 })),
    getConversationById: jest.fn(() =>
      Promise.resolve({ id: 5, buyer: { id: 2 }, seller: { id: 3 } }),
    ),
  };
  const dbUser = {
    id: 2,
    is_locked: false,
    token_version: opts.tokenVersionDb ?? 0,
  };
  const userRepository = {
    findOne: jest.fn(() => Promise.resolve(dbUser)),
    find: jest.fn(() => Promise.resolve([dbUser])),
    update: jest.fn(() => Promise.resolve()),
  };
  const dangMo = Array.from({ length: opts.soSocketDangMo ?? 0 }, (_, i) => ({
    id: `cu-${i}`,
    data: { user: { id: 2 } },
  }));
  const gateway = new ChatGateway(
    chatService as never,
    {
      verify: () => ({ sub: 2, full_name: 'Người mua', token_version: 0 }),
    } as never,
    { create: jest.fn(() => Promise.resolve()) } as never,
    userRepository as never,
  );
  gateway.server = {
    to: () => ({ emit: jest.fn() }),
    emit: jest.fn(),
    in: () => ({ fetchSockets: () => Promise.resolve(dangMo) }),
    fetchSockets: () => Promise.resolve(dangMo),
  } as never;
  return { gateway, chatService };
}

const tin = (i: number) => ({ conversationId: 5, content: `tin ${i}` });

describe('Giới hạn nhịp theo người dùng, không theo socket', () => {
  it('hai socket của cùng một người chia chung 10 tin mỗi 10 giây', async () => {
    const { gateway, chatService } = dung();
    const a = socket('a');
    const b = socket('b');

    for (let i = 0; i < 6; i++) await gateway.handleMessage(a as never, tin(i));
    for (let i = 0; i < 6; i++) await gateway.handleMessage(b as never, tin(i));

    expect(chatService.sendMessage).toHaveBeenCalledTimes(10);
  });
});

describe('Giới hạn số kết nối của một người', () => {
  it('đã có 5 socket thì socket thứ 6 bị ngắt', async () => {
    const { gateway } = dung({ soSocketDangMo: 5 });
    const s = socket('moi');
    s.data = {};

    await gateway.handleConnection(s as never);

    expect(s.disconnect).toHaveBeenCalled();
  });

  it('dưới hạn mức thì vào phòng riêng user_<id>', async () => {
    const { gateway } = dung({ soSocketDangMo: 1 });
    const s = socket('moi');
    s.data = {};

    await gateway.handleConnection(s as never);

    expect(s.disconnect).not.toHaveBeenCalled();
    expect(s.join).toHaveBeenCalledWith('user_2');
  });
});

describe('Phiên đã thu hồi mất socket', () => {
  it('token_version trong DB đã tăng: send_message ngắt socket, không gửi tin', async () => {
    const { gateway, chatService } = dung({ tokenVersionDb: 1 });
    const s = socket('a', 2, 0);

    await gateway.handleMessage(s as never, tin(0));

    expect(chatService.sendMessage).not.toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalled();
  });

  it('có lượt quét định kỳ ngắt socket đang chỉ NGHE của phiên đã thu hồi', async () => {
    const { gateway } = dung({ tokenVersionDb: 1 });
    const nghe = socket('nghe', 2, 0);
    gateway.server = {
      local: { fetchSockets: () => Promise.resolve([nghe]) },
    } as never;

    const quet = (
      gateway as unknown as { quetPhienDaThuHoi?: () => Promise<void> }
    ).quetPhienDaThuHoi;
    expect(typeof quet).toBe('function');
    await quet?.call(gateway);

    expect(nghe.disconnect).toHaveBeenCalledWith(true);
  });
});
