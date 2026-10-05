import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { nguCanh } from './request-context';
import { ghiDongLog } from './json-logger';

/**
 * Chỉ nhận mã request do client gửi khi nó VÔ HẠI.
 *
 * Header này đi thẳng vào log. Ai đó gửi `X-Request-Id` chứa xuống dòng và một
 * đoạn JSON giả là chèn được dòng log giả vào giữa log thật — người đọc sau sự
 * cố sẽ tin vào thứ kẻ tấn công viết ra. Nhận mã của client là để nối log qua
 * nhiều dịch vụ, không phải để cho họ viết vào nhật ký của mình.
 */
const HOP_LE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Mã tự sinh = tiền tố ngẫu nhiên của TIẾN TRÌNH + bộ đếm.
 *
 * `randomUUID()` mỗi request tốn 0,10 µs; bộ đếm tốn 0,04 (đo trong
 * `scripts/tmp-bench-mw.ts`). Chênh lệch nhỏ, nhưng thứ cần ở đây không phải
 * tính khó đoán — chỉ cần **duy nhất giữa các dòng log**. Tiền tố ngẫu nhiên
 * sinh một lần lúc khởi động là đủ để hai bản api không đụng mã nhau.
 *
 * Không dùng mã này cho bất kỳ việc gì liên quan bảo mật: nó đoán được.
 */
const TIEN_TO = randomUUID().slice(0, 8);
let dem = 0;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const gui = req.header('x-request-id');
    const reqId =
      gui && HOP_LE.test(gui) ? gui : `${TIEN_TO}-${(dem++).toString(36)}`;

    // Trả lại cho client TRƯỚC khi xử lý: gặp lỗi thì người dùng còn có mã để
    // báo, và người trực tra thẳng ra đúng request đó.
    res.setHeader('X-Request-Id', reqId);

    const batDau = process.hrtime.bigint();

    // `finish` chứ không phải sau `next()`: `next()` trả về ngay, phản hồi thì
    // mãi sau mới gửi xong. Ghi ở đây mới có mã trạng thái và thời gian thật.
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - batDau) / 1e6;
      ghiDongLog({
        level: res.statusCode >= 500 ? 'error' : 'info',
        reqId,
        msg: 'request',
        method: req.method,
        // `originalUrl` chứ không `path`: giữ cả chuỗi truy vấn thì mới biết
        // trang nào, bộ lọc nào — đúng thứ cần khi đi tìm chỗ chậm.
        path: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(ms * 100) / 100,
        userId: (req as Request & { user?: { id?: number } }).user?.id,
      });
    });

    // BỌC CẢ REQUEST TRONG NGỮ CẢNH — và đây là chỗ tốn tiền nhất của cả bài.
    //
    // Đo bằng `npm run loadtest`, cùng máy cùng cấu hình, đường sản phẩm ở mức
    // 50 người song song:
    //
    //   chưa thêm gì                    2.221 rps
    //   thêm log, KHÔNG ngữ cảnh        2.128 rps   −4%
    //   thêm log, có ngữ cảnh (run)     1.927 rps   −13%
    //   thêm log, có ngữ cảnh (enterWith) 1.914 rps −14%
    //
    // Hai điều đã đoán sai và phải đo mới biết:
    //
    //   1. Phép đo vi mô cho `als.run(() => {})` chỉ 0,05 µs — rẻ nhất nhóm.
    //      Nhưng cái giá thật KHÔNG nằm ở lời gọi: bật ngữ cảnh lên là Node
    //      phải theo dõi mọi thao tác bất đồng bộ của CẢ TIẾN TRÌNH. Đo một
    //      mảnh rời không thấy được điều đó.
    //   2. `enterWith` được cho là rẻ hơn `run`. Đo ra thì không.
    //
    // VÌ SAO VẪN GIỮ. 2.221 là trần khi CỐ Ý tắt rào nhịp để đo. Rào thật là 10
    // request/giây mỗi IP, nên chạm tới 1.927 cần khoảng 190 người bấm liên tục
    // trong cùng một giây. Đổi 13% của một trần không ai chạm tới lấy khả năng
    // lọc một mã ra cả đường đi của một request — đáng.
    //
    // Cần tốc độ thì gỡ đúng dòng này thành `next()`: mất mã request trong log
    // của service, giữ lại dòng tóm tắt mỗi request, và lấy lại 9%.
    nguCanh.run({ reqId }, () => next());
  }
}
