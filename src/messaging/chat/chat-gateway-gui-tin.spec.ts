import { ChatGateway } from './chat.gateway';

/**
 * send_message qua socket không kiểm gì cả.
 *
 * ValidationPipe toàn cục chỉ chạy cho HTTP; payload socket đi thẳng vào
 * ChatService.sendMessage. Đo trên mã hiện tại:
 *   - nội dung 1 MB vẫn được lưu và phát cho người nhận, rồi còn được chép
 *     nguyên vào nội dung thông báo đẩy;
 *   - images là mảng bao nhiêu phần tử, kiểu gì cũng nhận;
 *   - không có giới hạn nhịp: một vòng lặp phía client bắn hàng nghìn tin mỗi
 *     giây, mỗi tin là một INSERT, một UPDATE users.last_seen, một thông báo.
 * HTTP POST .../messages có SendMessageDto; socket là đường web và app dùng
 * thật nên càng phải có.
 */
type SocketGia = {
  data: { user?: { id: number; full_name: string; token_version: number } };
  emit: jest.Mock;
  disconnect: jest.Mock;
};

function dung() {
  const chatService = {
    sendMessage: jest.fn(() => Promise.resolve({ id: 1 })),
    getConversationById: jest.fn(() =>
      Promise.resolve({ id: 5, buyer: { id: 2 }, seller: { id: 3 } }),
    ),
  };
  const gateway = new ChatGateway(
    chatService as never,
    {} as never,
    { create: jest.fn(() => Promise.resolve()) } as never,
    // Phiên còn hiệu lực: token_version trên socket khớp DB.
    {
      update: jest.fn(() => Promise.resolve()),
      findOne: jest.fn(() =>
        Promise.resolve({ is_locked: false, token_version: 0 }),
      ),
    } as never,
  );
  gateway.server = { to: () => ({ emit: jest.fn() }) } as never;
  const socket: SocketGia = {
    data: { user: { id: 2, full_name: 'Người mua', token_version: 0 } },
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  return { gateway, chatService, socket };
}

describe('send_message có kiểm dữ liệu và giới hạn nhịp', () => {
  it('nội dung quá 2000 ký tự bị từ chối', async () => {
    const { gateway, chatService, socket } = dung();

    await gateway.handleMessage(socket as never, {
      conversationId: 5,
      content: 'a'.repeat(2001),
    });

    expect(chatService.sendMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('nội dung rỗng bị từ chối', async () => {
    const { gateway, chatService, socket } = dung();

    await gateway.handleMessage(socket as never, {
      conversationId: 5,
      content: '',
    });

    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  it('quá 10 ảnh bị từ chối', async () => {
    const { gateway, chatService, socket } = dung();

    await gateway.handleMessage(socket as never, {
      conversationId: 5,
      content: 'xem ảnh',
      images: Array.from({ length: 11 }, (_, i) => `https://img/${i}.jpg`),
    });

    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  it('ảnh không phải chuỗi bị từ chối', async () => {
    const { gateway, chatService, socket } = dung();

    await gateway.handleMessage(socket as never, {
      conversationId: 5,
      content: 'xem ảnh',
      images: [{ x: 1 }] as never,
    });

    expect(chatService.sendMessage).not.toHaveBeenCalled();
  });

  it('tin hợp lệ thì gửi', async () => {
    const { gateway, chatService, socket } = dung();

    await gateway.handleMessage(socket as never, {
      conversationId: 5,
      content: 'Còn hàng không shop?',
    });

    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('một socket bắn dồn dập thì từ tin thứ 11 trong 10 giây bị chặn', async () => {
    const { gateway, chatService, socket } = dung();

    for (let i = 0; i < 15; i++) {
      await gateway.handleMessage(socket as never, {
        conversationId: 5,
        content: `tin ${i}`,
      });
    }

    expect(chatService.sendMessage).toHaveBeenCalledTimes(10);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.any(String));
  });
});
