import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatService } from './chat.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * PATCH /chat/conversations/:id/read có hai lỗi:
 *
 *   1. Không kiểm thành viên: ai đăng nhập cũng đánh dấu "đã đọc" được hội
 *      thoại của người khác, xoá chấm đỏ của họ, tức người nhận không biết có
 *      tin mới.
 *   2. Đánh dấu cả tin DO CHÍNH NGƯỜI GỌI GỬI. Người mua mở hội thoại là tin họ
 *      vừa gửi cũng thành is_read = 1, nên người bán không bao giờ thấy chưa đọc.
 *      getUnreadCount và demChuaDocTheoLo đã loại tin của chính mình từ lâu;
 *      markAsRead thì chưa.
 *
 * Chạy trên MySQL thật vì cách vá là điều kiện trong câu UPDATE.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('markAsRead: chỉ thành viên, chỉ tin của người kia', () => {
  let ds: DataSource;
  let svc: ChatService;
  const R = Math.floor(Math.random() * 100_000);
  const MUA = 9_200_000 + R;
  const BAN = 9_300_000 + R;
  const NGOAI = 9_400_000 + R;
  let convId: number;
  let tinCuaMua: number;
  let tinCuaBan: number;

  const daDoc = async (id: number) => {
    const m = await ds.getRepository(Message).findOne({ where: { id } });
    return m?.is_read;
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      ...TEST_DB,
      entities: [Conversation, Message, Product, Category, User],
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
    svc = new ChatService(
      ds.getRepository(Conversation),
      ds.getRepository(Message),
      ds.getRepository(Product),
    );
  });

  beforeEach(async () => {
    const users = ds.getRepository(User);
    for (const id of [MUA, BAN, NGOAI]) {
      await users.save({
        id,
        full_name: `User ${id}`,
        email: `doc-${id}@test.local`,
        password: 'x',
        role: 'buyer',
      } as User);
    }
    const conv = await ds.getRepository(Conversation).save({
      buyer: { id: MUA },
      seller: { id: BAN },
    } as Conversation);
    convId = conv.id;
    const msgs = ds.getRepository(Message);
    tinCuaMua = (
      await msgs.save({
        conversation: { id: convId },
        sender: { id: MUA },
        content: 'Còn hàng không?',
        is_read: false,
      } as Message)
    ).id;
    tinCuaBan = (
      await msgs.save({
        conversation: { id: convId },
        sender: { id: BAN },
        content: 'Còn bạn ơi',
        is_read: false,
      } as Message)
    ).id;
  });

  afterEach(async () => {
    await ds.getRepository(Conversation).delete({ id: convId });
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(User).delete([MUA, BAN, NGOAI]);
      await ds.destroy();
    }
  });

  // 404 như hội thoại không tồn tại, không phải 400 "không phải thành viên":
  // hai câu khác nhau là cho người ngoài biết id nào có thật (dò hội thoại).
  it('người ngoài hội thoại nhận cùng 404 như id không tồn tại, không tin nào đổi', async () => {
    await expect(
      svc.markAsRead(convId, { id: NGOAI, role: 'buyer' } as IUser),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.markAsRead(987654321, { id: NGOAI, role: 'buyer' } as IUser),
    ).rejects.toThrow(NotFoundException);

    expect(await daDoc(tinCuaMua)).toBe(false);
    expect(await daDoc(tinCuaBan)).toBe(false);
  });

  it('người mua đọc: tin của người bán thành đã đọc, tin của chính mình giữ nguyên', async () => {
    await svc.markAsRead(convId, { id: MUA, role: 'buyer' } as IUser);

    expect(await daDoc(tinCuaBan)).toBe(true);
    expect(await daDoc(tinCuaMua)).toBe(false);
  });
});
