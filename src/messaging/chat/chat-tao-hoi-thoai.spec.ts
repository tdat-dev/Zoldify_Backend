import { BadRequestException } from '@nestjs/common';
import type { IUser } from '@identity/users/users.interface';
import { ChatService } from './chat.service';

/**
 * POST /chat/conversations tin `seller_id` do client gửi.
 *
 * Bản trước chỉ kiểm sản phẩm có tồn tại, rồi tạo hội thoại với
 * `seller: { id: seller_id }` lấy nguyên từ body. Hậu quả:
 *   - mở hội thoại "về sản phẩm X" với một người bất kỳ không liên quan tới X
 *     (seller_id tự chọn), tức nhắn tin rác tới bất kỳ ai, gắn kèm sản phẩm
 *     của người khác để trông như thật;
 *   - seller_id = chính mình: hội thoại với chính mình, đếm chưa đọc sai.
 * Cả web lẫn app đều gửi seller_id đúng là người bán của sản phẩm, nên lấy
 * người bán từ sản phẩm không đổi gì với client thật.
 */
const NGUOI_MUA = { id: 2, role: 'buyer' } as IUser;

function dung(nguoiBanCuaSanPham: number) {
  const daTao: Array<{ seller: { id: number } }> = [];
  const conversationRepository = {
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((x: { seller: { id: number } }) => {
      daTao.push(x);
      return x;
    }),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
  };
  const productRepository = {
    findOne: jest.fn(() =>
      Promise.resolve({ id: 5, seller: { id: nguoiBanCuaSanPham } }),
    ),
  };
  const service = new ChatService(
    conversationRepository as never,
    {} as never,
    productRepository as never,
  );
  return { service, daTao };
}

describe('Tạo hội thoại lấy người bán từ sản phẩm', () => {
  it('seller_id giả bị bỏ qua: hội thoại mở với người bán thật của sản phẩm', async () => {
    const { service, daTao } = dung(3);

    await service.createConversation(
      { seller_id: 99, product_id: 5 },
      NGUOI_MUA,
    );

    expect(daTao).toHaveLength(1);
    expect(daTao[0].seller).toEqual({ id: 3 });
  });

  it('nhắn về sản phẩm của chính mình bị từ chối', async () => {
    const { service, daTao } = dung(NGUOI_MUA.id);

    await expect(
      service.createConversation(
        { seller_id: NGUOI_MUA.id, product_id: 5 },
        NGUOI_MUA,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(daTao).toHaveLength(0);
  });

  it('seller_id là chính mình bị từ chối', async () => {
    const { service, daTao } = dung(3);

    await expect(
      service.createConversation(
        { seller_id: NGUOI_MUA.id, product_id: 5 },
        NGUOI_MUA,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(daTao).toHaveLength(0);
  });

  it('client gửi đúng người bán thì tạo bình thường', async () => {
    const { service, daTao } = dung(3);

    await service.createConversation(
      { seller_id: 3, product_id: 5 },
      NGUOI_MUA,
    );

    expect(daTao[0].seller).toEqual({ id: 3 });
  });
});
