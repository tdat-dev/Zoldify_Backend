import { DataSource } from 'typeorm';
import { ChatService } from './chat.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Category } from '@catalog/categories/entities/category.entity';
import { User } from '@identity/users/entities/user.entity';
import type { IUser } from '@identity/users/users.interface';

/**
 * Chat trả nguyên dòng users của người kia.
 *
 * GET /chat/conversations nạp relations buyer, seller; GET .../messages nạp
 * sender. Cả ba là nguyên dòng users: email, số điện thoại, vai trò,
 * token_version, is_locked. Người mua nhắn hỏi giá một món là đọc được email và
 * số điện thoại tài khoản của người bán (và ngược lại), trong khi sàn cố ý giữ
 * liên lạc trong khung chat.
 *
 * Cột được giữ theo đúng thứ client đọc (kiểm 26/10): web và app đọc
 * partner_name, partner_avatar, partner_last_seen, partner_id và sender.id. Nên
 * buyer/seller/sender chỉ còn id, full_name, avatar, last_seen.
 */
const TEST_DB = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3307),
  username: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? 'testpw',
  database: process.env.TEST_DB_NAME ?? 'zoldify_test',
};

jest.setTimeout(60_000);

const COT_DUOC_PHEP = ['id', 'full_name', 'avatar', 'last_seen'];
const khoa = (x: unknown) =>
  Object.keys(JSON.parse(JSON.stringify(x)) as object);

describe('Chat không trả hồ sơ tài khoản của người kia', () => {
  let ds: DataSource;
  let svc: ChatService;
  const R = Math.floor(Math.random() * 100_000);
  const MUA = 9_600_000 + R;
  const BAN = 9_700_000 + R;
  let convId: number;

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
    const users = ds.getRepository(User);
    for (const id of [MUA, BAN]) {
      await users.save({
        id,
        full_name: `User ${id}`,
        email: `lo-chat-${id}@test.local`,
        phone_number: '0901234567',
        password: 'x',
        role: 'buyer',
      } as User);
    }
    convId = (
      await ds.getRepository(Conversation).save({
        buyer: { id: MUA },
        seller: { id: BAN },
      } as Conversation)
    ).id;
    await ds.getRepository(Message).save({
      conversation: { id: convId },
      sender: { id: BAN },
      content: 'Chào bạn',
    } as Message);
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.getRepository(Conversation).delete({ id: convId });
      await ds.getRepository(User).delete([MUA, BAN]);
      await ds.destroy();
    }
  });

  it('danh sách hội thoại: buyer và seller chỉ có id, full_name, avatar, last_seen', async () => {
    const { result } = await svc.getMyConversations({
      id: MUA,
      role: 'buyer',
    } as IUser);
    const c = result.find((x) => x.id === convId);
    expect(c).toBeDefined();
    for (const k of [...khoa(c?.buyer), ...khoa(c?.seller)]) {
      expect(COT_DUOC_PHEP).toContain(k);
    }
    expect(c?.partner_name).toBe(`User ${BAN}`);
  });

  it('tin nhắn: sender chỉ có id, full_name, avatar, last_seen', async () => {
    const { result } = await svc.getMessages(convId, '1', '20', {
      id: MUA,
      role: 'buyer',
    } as IUser);
    expect(result).toHaveLength(1);
    expect(result[0].sender?.id).toBe(BAN);
    for (const k of khoa(result[0].sender)) {
      expect(COT_DUOC_PHEP).toContain(k);
    }
  });
});
