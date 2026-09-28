import { ForbiddenException } from '@nestjs/common';
import { EscrowsController } from './escrows.controller';
import { EscrowsService } from './escrows.service';
import { NotificationsController } from '@messaging/notifications/notifications.controller';
import { AdminGuard } from '@common/guards/admin.guard';
import { IUser } from '@identity/users/users.interface';
import { UserRole } from '@identity/users/entities/user.entity';

/**
 * Bài kiểm cho hai lỗ hổng đã bịt (audit B-02, B-03, 28/09).
 *
 * B-03: mọi route /escrows chỉ cần đăng nhập và nạp nguyên bản ghi users của
 * người mua lẫn người bán. `GET /escrows?limit=...` là đủ để tải về tên, email,
 * số điện thoại, địa chỉ nhận hàng của mọi đơn trên sàn.
 *
 * B-02: `POST /notifications` nhận user_id tuỳ ý và bắn push FCM thật, nên ai
 * cũng gửi được thông báo giả danh Zoldify tới bất kỳ ai.
 */
const guardsOf = (cls: any, handler: string): unknown[] =>
  Reflect.getMetadata('__guards__', cls.prototype[handler]) ?? [];

const SAFE_USER = { id: true, full_name: true, avatar: true };

describe('B-02: POST /notifications chỉ dành cho admin', () => {
  it('create() có AdminGuard', () => {
    expect(guardsOf(NotificationsController, 'create')).toContain(AdminGuard);
  });
});

describe('B-03: /escrows theo quyền sở hữu', () => {
  const buyer: IUser = {
    id: 7,
    email: 'kev@t.local',
    full_name: 'Kẻ thử lách',
    role: UserRole.BUYER,
    avatar: '',
  };
  const seller: IUser = { ...buyer, id: 8, role: UserRole.SELLER };
  const admin: IUser = { ...buyer, id: 1, role: UserRole.ADMIN };

  describe('controller', () => {
    const calls: string[] = [];
    const service = {
      findBySeller: async () => calls.push('findBySeller'),
      getHeldBalance: async () => calls.push('getHeldBalance'),
    } as never;
    const controller = new EscrowsController(service);

    beforeEach(() => (calls.length = 0));

    it('danh sách toàn sàn chỉ cho admin', () => {
      expect(guardsOf(EscrowsController, 'findAll')).toContain(AdminGuard);
    });

    it.each(['findBySeller', 'getHeldBalance'] as const)(
      '%s: xem của người bán khác thì bị cấm',
      async (method) => {
        const call =
          method === 'findBySeller'
            ? controller.findBySeller('8', '1', '20', '', buyer)
            : controller.getHeldBalance('8', buyer);
        await expect(call).rejects.toThrow(ForbiddenException);
        expect(calls).toHaveLength(0);
      },
    );

    it('người bán xem của chính mình, admin xem của bất kỳ ai', async () => {
      await controller.findBySeller('8', '1', '20', '', seller);
      await controller.getHeldBalance('8', seller);
      await controller.findBySeller('8', '1', '20', '', admin);
      await controller.getHeldBalance('8', admin);
      expect(calls).toHaveLength(4);
    });
  });

  describe('service', () => {
    const captured: any[] = [];
    const repo = {
      find: async (opts: any) => (captured.push(opts), []),
      findAndCount: async (opts: any) => (captured.push(opts), [[], 0]),
    };
    const service = new EscrowsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    beforeEach(() => (captured.length = 0));

    it('findByOrder: người thường chỉ thấy khoản mình là người mua hoặc bán', async () => {
      await service.findByOrder(99, buyer);
      expect(captured[0].where).toEqual([
        { order: { id: 99 }, buyer: { id: 7 } },
        { order: { id: 99 }, seller: { id: 7 } },
      ]);
    });

    it('findByOrder: admin thấy mọi khoản của đơn', async () => {
      await service.findByOrder(99, admin);
      expect(captured[0].where).toEqual({ order: { id: 99 } });
    });

    it('không trả nguyên bản ghi users (email, SĐT) ra ngoài', async () => {
      await service.findByOrder(99, admin);
      await service.findBySeller(8, 1, 20);
      await service.findAll(1, 20);
      for (const opts of captured) {
        for (const party of ['buyer', 'seller'] as const) {
          if (opts.relations?.includes(party)) {
            expect(opts.select?.[party]).toEqual(SAFE_USER);
          }
        }
      }
    });
  });
});
