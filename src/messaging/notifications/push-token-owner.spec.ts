import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { IUser } from '@identity/users/users.interface';
import { UserRole } from '@identity/users/entities/user.entity';

/**
 * `DELETE /notifications/push-token` chỉ gỡ token của CHÍNH người gọi.
 *
 * Bản đầu xoá theo mỗi chuỗi token, không đối chiếu chủ sở hữu: ai đăng nhập
 * mà biết (hoặc đoán) được token FCM của thiết bị người khác là gỡ được, và
 * thiết bị đó lặng lẽ thôi nhận thông báo đơn hàng. Lộ ra khi review gộp nhánh
 * prod vào staging (29/09).
 */
describe('Gỡ push token theo chủ sở hữu', () => {
  const user: IUser = {
    id: 7,
    email: 'a@t.local',
    full_name: 'A',
    role: UserRole.BUYER,
    avatar: '',
  };

  it('service xoá theo cả token lẫn user, không chỉ token', async () => {
    const deleted: unknown[] = [];
    const pushRepo = {
      delete: (criteria: unknown) => {
        deleted.push(criteria);
        return Promise.resolve({ affected: 0 });
      },
    };
    const service = new NotificationsService(
      {} as never,
      pushRepo as never,
      {} as never,
    );

    await service.unregisterToken('tok-cua-nguoi-khac', user.id);

    expect(deleted).toEqual([{ token: 'tok-cua-nguoi-khac', user: { id: 7 } }]);
  });

  it('controller truyền id của người đang đăng nhập xuống service', async () => {
    const calls: unknown[][] = [];
    const service = {
      unregisterToken: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ unregistered: true });
      },
    };
    const controller = new NotificationsController(service as never);

    await controller.unregisterPushToken({ token: 't' } as never, user);

    expect(calls).toEqual([['t', 7]]);
  });
});
