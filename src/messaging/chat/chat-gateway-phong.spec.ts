import { ChatGateway } from './chat.gateway';

/**
 * A-07: join_conversation cho vào BẤT KỲ phòng nào.
 *
 * Gateway gọi thẳng `client.join(\`conv_${id}\`)` với id do client gửi, không
 * hỏi người đó có phải người mua hay người bán của hội thoại. Mọi tin nhắn
 * được phát vào phòng `conv_<id>` (receive_message), nên chỉ cần đăng nhập là
 * nghe lén được mọi cuộc trò chuyện, chỉ việc đếm id từ 1 trở lên. HTTP
 * GET /chat/conversations/:id/messages đã kiểm thành viên từ lâu; socket thì
 * chưa.
 */
type SocketGia = {
  data: { user?: { id: number } };
  join: jest.Mock;
  emit: jest.Mock;
};

function dung(hoiThoai: unknown) {
  const chatService = {
    getConversationById: jest.fn(() => Promise.resolve(hoiThoai)),
  };
  const gateway = new ChatGateway(
    chatService as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const socket = (userId: number): SocketGia => ({
    data: { user: { id: userId } },
    join: jest.fn(),
    emit: jest.fn(),
  });
  return { gateway, socket };
}

const HOI_THOAI = { id: 5, buyer: { id: 2 }, seller: { id: 3 } };

describe('join_conversation chỉ cho thành viên vào phòng', () => {
  it('người ngoài không vào được phòng, nhận sự kiện error', async () => {
    const { gateway, socket } = dung(HOI_THOAI);
    const s = socket(99);

    await gateway.handleJoinConversation(s as never, 5);

    expect(s.join).not.toHaveBeenCalled();
    expect(s.emit).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('hội thoại không tồn tại thì không vào phòng', async () => {
    const { gateway, socket } = dung(null);
    const s = socket(2);

    await gateway.handleJoinConversation(s as never, 404);

    expect(s.join).not.toHaveBeenCalled();
  });

  it('người mua vào được', async () => {
    const { gateway, socket } = dung(HOI_THOAI);
    const s = socket(2);

    await gateway.handleJoinConversation(s as never, 5);

    expect(s.join).toHaveBeenCalledWith('conv_5');
  });

  it('người bán vào được', async () => {
    const { gateway, socket } = dung(HOI_THOAI);
    const s = socket(3);

    await gateway.handleJoinConversation(s as never, 5);

    expect(s.join).toHaveBeenCalledWith('conv_5');
  });
});
