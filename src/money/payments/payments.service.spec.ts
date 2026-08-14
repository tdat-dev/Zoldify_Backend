import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { IUser } from '@identity/users/users.interface';
import { UserRole } from '@identity/users/entities/user.entity';

/**
 * Bài kiểm cho một lỗ hổng đã bịt, không phải cho một tính năng.
 *
 * Tới 14/08, `POST /api/v1/payments` với body `{"amount": 999999999}` gọi thẳng
 * `walletsService.topup(user.id, amount)`. Bất kỳ tài khoản nào đã đăng nhập
 * cũng tự cộng cho mình số tiền tuỳ ý — không ngân hàng nào chuyển, không admin
 * nào duyệt, và bút toán sinh ra trông y hệt một lần nạp thật. Số tiền đó tiêu
 * được ngay và rút ra được bằng POST /withdrawals.
 *
 * Không cần database ở đây: điều cần khẳng định là hàm này KHÔNG chạm tới ví.
 * Đưa vào một WalletsService giả mà mọi phương thức đều nổ — nếu có ngày ai đó
 * nối lại đường cũ, bài kiểm đỏ ngay.
 */
describe('PaymentsService — không có đường tự nạp ví', () => {
  const user: IUser = {
    id: 7,
    email: 'kev@t.local',
    full_name: 'Kẻ thử lách',
    role: UserRole.BUYER,
    avatar: '',
  };

  const explode = (name: string) => () => {
    throw new Error(`PaymentsService không được gọi WalletsService.${name}()`);
  };

  const wallets = {
    topup: explode('topup'),
    deduct: explode('deduct'),
    transfer: explode('transfer'),
  } as never;

  const repos = {
    create: () => ({}),
    save: async (x: unknown) => x,
    findOne: async () => null,
  } as never;

  const service = new PaymentsService(repos, repos, repos, wallets);

  it('gửi amount thì bị từ chối, ví không hề bị chạm vào', async () => {
    await expect(service.create({ amount: 999_999_999 }, user)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('thông báo chỉ đúng đường nạp tiền thật', async () => {
    await expect(service.create({ amount: 50_000 }, user)).rejects.toThrow(
      /PayOS/,
    );
  });

  it('không có order_id lẫn amount thì vẫn báo thiếu tham số', async () => {
    await expect(service.create({}, user)).rejects.toThrow(
      /order_id hoặc amount/,
    );
  });
});
