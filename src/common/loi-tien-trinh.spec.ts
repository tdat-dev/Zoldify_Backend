import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  function dung(daKhoiDong = true) {
    const tienTrinh = new EventEmitter();
    const loi: string[] = [];
    const thoat: number[] = [];
    const bat = ganBatLoiTienTrinh('thu', {
      tienTrinh,
      logger: { error: (m: string) => loi.push(m) },
      thoat: (ma: number) => thoat.push(ma),
    });
    if (daKhoiDong) bat.daKhoiDong();
    return { tienTrinh, loi, thoat, bat };
  }

  it('unhandledRejection SAU khi đã khởi động: ghi log error, KHÔNG thoát', () => {
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

  /**
   * Review 26/10: bộ bắt chỉ ghi log thì một lỗi lúc KHỞI ĐỘNG (cổng bị
   * chiếm, DB không nối được, cấu hình sai) không còn làm tiến trình chết:
   * container hiện "Up" mà không nghe cổng nào, và `restart: unless-stopped`
   * không bao giờ dựng lại. Trước khi khởi động xong thì PHẢI thoát.
   */
  it('unhandledRejection TRONG LÚC khởi động: ghi log rồi thoát mã 1', () => {
    const { tienTrinh, loi, thoat } = dung(false);
    tienTrinh.emit('unhandledRejection', new Error('EADDRINUSE :3000'));
    expect(loi.join('\n')).toMatch(/EADDRINUSE/);
    expect(thoat).toEqual([1]);
  });

  it('main.ts bắt lỗi bootstrap() và chỉ đánh dấu đã khởi động SAU app.listen', () => {
    const ma = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(ma).toMatch(/bootstrap\(\)\s*\.catch\(/);
    const listen = ma.indexOf('await app.listen(');
    const danhDau = ma.indexOf('.daKhoiDong()');
    expect(listen).toBeGreaterThan(-1);
    expect(danhDau).toBeGreaterThan(listen);
  });

  it('worker.ts đánh dấu đã khởi động sau khi dựng xong WorkerModule', () => {
    const ma = readFileSync(join(__dirname, '..', 'worker.ts'), 'utf8');
    const dung = ma.indexOf('createApplicationContext(');
    const danhDau = ma.indexOf('.daKhoiDong()');
    expect(dung).toBeGreaterThan(-1);
    expect(danhDau).toBeGreaterThan(dung);
  });
});
