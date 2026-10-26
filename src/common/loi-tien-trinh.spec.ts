import { EventEmitter } from 'node:events';
import { ganBatLoiTienTrinh } from './loi-tien-trinh';

/**
 * BÀI KIỂM ĐỎ, rà soát 26/10 mục 6: tiến trình phải có bộ bắt lỗi cuối cùng.
 *
 * Node 15+ mặc định `--unhandled-rejections=throw`: MỘT lời hứa bị từ chối mà
 * không ai `.catch` là cả tiến trình api chết, kéo theo mọi request đang chạy.
 * `notifications.service.ts` có đúng một chỗ như thế (`void this.pushToUser`):
 * FCM từ chối là đủ. Không có bộ bắt nào ở `main.ts` lẫn `worker.ts`, nên log
 * chỉ còn dòng stack mặc định của Node, không qua JsonLogger, không mã request.
 */
describe('ganBatLoiTienTrinh', () => {
  function dung() {
    const tienTrinh = new EventEmitter();
    const loi: string[] = [];
    const thoat: number[] = [];
    ganBatLoiTienTrinh('thu', {
      tienTrinh,
      logger: { error: (m: string) => loi.push(m) },
      thoat: (ma: number) => thoat.push(ma),
    });
    return { tienTrinh, loi, thoat };
  }

  it('unhandledRejection: ghi log error, KHÔNG thoát', () => {
    const { tienTrinh, loi, thoat } = dung();
    tienTrinh.emit('unhandledRejection', new Error('FCM từ chối'));
    expect(loi.join('\n')).toMatch(/unhandledRejection.*FCM từ chối/);
    expect(thoat).toEqual([]);
  });

  it('unhandledRejection với lý do không phải Error vẫn ghi được', () => {
    const { tienTrinh, loi } = dung();
    tienTrinh.emit('unhandledRejection', 'chuoi tran');
    expect(loi.join('\n')).toMatch(/chuoi tran/);
  });

  it('uncaughtException: ghi log error rồi thoát mã 1', () => {
    const { tienTrinh, loi, thoat } = dung();
    tienTrinh.emit('uncaughtException', new Error('hỏng cứng'));
    expect(loi.join('\n')).toMatch(/uncaughtException.*hỏng cứng/);
    expect(thoat).toEqual([1]);
  });
});
