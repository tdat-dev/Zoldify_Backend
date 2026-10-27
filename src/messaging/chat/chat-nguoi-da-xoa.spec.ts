import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatService } from './chat.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * Hội thoại với một tài khoản đã bị xoá mềm trả 500.
 *
 * `users` xoá mềm (DeleteDateColumn), nên TypeORM nạp quan hệ buyer/seller của
 * người đã xoá thành `null`. `getMessages` và `sendMessage` đọc thẳng
 * `conversation.buyer.id` / `conversation.seller.id`: một bên đã xoá là
 * TypeError, người còn lại mở hội thoại cũ nhận 500 thay vì đọc được lịch sử.
 *
 * Hành vi đúng: người còn lại VẪN đọc được tin cũ (người kia hiện là tài khoản
 * đã xoá), gửi tin mới thì nhận 400 có lời giải thích, người ngoài vẫn 404/400
 * như trước.
 *
 * Chạy trên MySQL thật: thứ cần đo là cách TypeORM nạp quan hệ của dòng đã xoá
 * mềm, repository giả không tái hiện được.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

describe('Chat với tài khoản đã xoá', () => {
  let ds: DataSource;
  let svc: ChatService;
  const R = Math.floor(Math.random() * 100_000);
  const MUA = 9_500_000 + R;
  const BAN = 9_600_000 + R;
  const NGOAI = 9_700_000 + R;
  let convId: number;

  const ai = (id: number): IUser =>
    ({ id, role: 'buyer', email: '', full_name: '', avatar: '' }) as IUser;

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
        email: `xoa-${id}@test.local`,
        password: 'x',
        role: 'buyer',
        deleted_at: null,
      } as unknown as User);
    }
    const conv = await ds.getRepository(Conversation).save({
      buyer: { id: MUA },
      seller: { id: BAN },
    } as Conversation);
    convId = conv.id;
    await ds.getRepository(Message).save({
      conversation: { id: convId },
      sender: { id: BAN },
      content: 'Hàng còn bạn nhé',
      is_read: false,
    } as Message);
    // Người bán xoá tài khoản.
    await users.softDelete(BAN);
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

  it('người còn lại vẫn đọc được tin cũ, người kia hiện là tài khoản đã xoá', async () => {
    const kq = await svc.getMessages(convId, '1', '20', ai(MUA));

    expect(kq.result).toHaveLength(1);
    const sender = kq.result[0].sender as { id?: number; full_name?: string };
    // Giữ id để client vẫn phân biệt được "tin của mình" và "tin của người kia".
    expect(sender?.id).toBe(BAN);
    expect(sender?.full_name).toMatch(/đã xoá|đã xóa/i);
  });

  it('gửi tin cho người đã xoá → 400 có lời giải thích, không 500', async () => {
    await expect(
      svc.sendMessage(convId, { content: 'Còn không?' } as never, ai(MUA)),
    ).rejects.toBeInstanceOf(BadRequestException);
    const soTin = await ds
      .getRepository(Message)
      .count({ where: { conversation: { id: convId } } });
    expect(soTin).toBe(1);
  });

  it('người ngoài vẫn bị chặn như trước', async () => {
    await expect(
      svc.getMessages(convId, '1', '20', ai(NGOAI)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.markAsRead(convId, ai(NGOAI))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('danh sách hội thoại hiện người kia là tài khoản đã xoá', async () => {
    const kq = await svc.getMyConversations(ai(MUA));
    const c = kq.result.find((r) => r.id === convId);
    expect(c).toBeDefined();
    expect(c?.partner_name).toMatch(/đã xoá|đã xóa/i);
  });
});
