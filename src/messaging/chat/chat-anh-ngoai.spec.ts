import { BadRequestException } from '@nestjs/common';
import type { IUser } from '@identity/users/users.interface';
import { ChatService } from './chat.service';

/**
 * Ảnh trong tin nhắn nhận URL bất kỳ.
 *
 * images là mảng chuỗi client gửi, lưu nguyên rồi client người nhận tự tải về
 * hiển thị. URL trỏ ra máy chủ của kẻ gửi là:
 *   - lộ IP, thiết bị, giờ mở tin của người nhận cho kẻ gửi (ảnh theo dõi);
 *   - ảnh "thay đổi sau khi gửi": kẻ gửi đổi nội dung file trên máy mình sau khi
 *     người kia đã xem, sàn không còn bằng chứng nào về thứ đã hiển thị;
 *   - lối đi cho javascript:, data: nếu client nào đó render không cẩn thận.
 * Ảnh chat thật luôn tải qua POST /files/upload, tức nằm trên host của sàn (R2
 * công khai, CDN, hoặc chính API khi R2 chưa cấu hình). Chỉ nhận các host đó.
 */
const BIEN = ['R2_PUBLIC_URL', 'CDN_BASE_URL', 'API_PUBLIC_URL'] as const;

function dung() {
  const save = jest.fn((x: unknown) => Promise.resolve(x));
  const svc = new ChatService(
    {
      findOne: jest.fn(() =>
        Promise.resolve({ id: 5, buyer: { id: 2 }, seller: { id: 3 } }),
      ),
      update: jest.fn(() => Promise.resolve()),
    } as never,
    { create: (x: unknown) => x, save } as never,
    {} as never,
  );
  return { svc, save };
}

const NGUOI = { id: 2, role: 'buyer' } as IUser;

describe('Ảnh trong tin nhắn chỉ được nằm trên host của sàn', () => {
  const cu: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of BIEN) cu[k] = process.env[k];
    process.env.R2_PUBLIC_URL = 'https://img.zoldify.com';
    process.env.API_PUBLIC_URL = 'https://api.zoldify.com';
    delete process.env.CDN_BASE_URL;
  });
  afterAll(() => {
    for (const k of BIEN) {
      if (cu[k] === undefined) delete process.env[k];
      else process.env[k] = cu[k];
    }
  });

  it.each([
    'https://evil.example/theo-doi.jpg',
    'https://img.zoldify.com.evil.example/a.jpg',
    'http://img.zoldify.com/a.jpg',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'khong-phai-url',
  ])('từ chối %s', async (url) => {
    const { svc, save } = dung();
    await expect(
      svc.sendMessage(5, { content: 'xem ảnh', images: [url] }, NGUOI),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('nhận ảnh trên R2 và trên API', async () => {
    const { svc, save } = dung();
    await svc.sendMessage(
      5,
      {
        content: 'xem ảnh',
        images: [
          'https://img.zoldify.com/chat/a.jpg',
          'https://api.zoldify.com/public/images/chat/b.jpg',
        ],
      },
      NGUOI,
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('tin không ảnh vẫn gửi được', async () => {
    const { svc, save } = dung();
    await svc.sendMessage(5, { content: 'chào' }, NGUOI);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
