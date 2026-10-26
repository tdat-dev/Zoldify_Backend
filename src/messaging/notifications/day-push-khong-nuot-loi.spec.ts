import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 6: `void this.pushToUser(...)` không có
 * `.catch`.
 *
 * Đọc token hỏng (database chập) hay FCM từ chối là một lời hứa bị từ chối
 * không ai bắt. Node 15+ mặc định coi đó là lỗi chết người và tắt cả tiến
 * trình api. Thông báo đã lưu xong, nên đây đúng ra chỉ là "mất một lần đẩy".
 */
describe('NotificationsService.create: đẩy push hỏng thì log, không nổ', () => {
  it('pushToUser từ chối thì có dòng log, không có lời hứa mồ côi', async () => {
    const canhBao = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moCoi: unknown[] = [];
    const nghe = (l: unknown) => moCoi.push(l);
    process.on('unhandledRejection', nghe);

    const svc = new NotificationsService(
      {
        create: (x: unknown) => x,
        save: (x: object) => Promise.resolve({ id: 1, ...x }),
      } as never,
      {
        find: () => Promise.reject(new Error('mất kết nối database')),
      } as never,
      {} as never,
    );

    await svc.create({
      user_id: 9,
      type: 'system' as never,
      title: 't',
      content: 'c',
    });
    // Cho lời hứa bị bỏ rơi kịp nổ (nếu có) trước khi kiểm.
    await new Promise((r) => setTimeout(r, 50));

    process.off('unhandledRejection', nghe);
    expect(moCoi).toEqual([]);
    expect(canhBao.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /mất kết nối database/,
    );
    canhBao.mockRestore();
  });

  /**
   * Review 26/10 mục 9. Job báo hàng mới đặt trần 10 lời gọi cùng lúc, nhưng
   * `create` không chờ lần đẩy FCM: trần chỉ chặn câu INSERT, còn FCM bị gọi
   * dồn không giới hạn. Job cần một cách gọi CHỜ đẩy xong (không đổi hành vi
   * của mọi nơi gọi khác).
   */
  it('create(..., { choDayPush: true }) chỉ xong khi lần đẩy FCM đã xong; hỏng thì vẫn không ném', async () => {
    let dayXong = false;
    const svc = new NotificationsService(
      {
        create: (x: unknown) => x,
        save: (x: object) => Promise.resolve({ id: 2, ...x }),
      } as never,
      {
        find: () => Promise.resolve([{ token: 'tok-1' }]),
        delete: () => Promise.resolve({}),
      } as never,
      {
        sendPush: async () => {
          await new Promise((r) => setTimeout(r, 30));
          dayXong = true;
          return [];
        },
      } as never,
    );
    const goi = (
      svc as unknown as {
        create: (d: object, o: { choDayPush: boolean }) => Promise<unknown>;
      }
    ).create;

    await goi.call(
      svc,
      { user_id: 9, type: 'system', title: 't', content: 'c' },
      { choDayPush: true },
    );
    expect(dayXong).toBe(true);
  });
});
