import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { EventEmitter } from 'node:events';

/**
 * Tắt api mà không làm rơi request nào, để deploy khởi động lại lần lượt từng
 * bản (`scripts/deploy/lan-luot-api.sh`) mà caddy không trả 502.
 *
 * VÌ SAO CẦN. Node chạy là PID 1 trong container. PID 1 không có bộ bắt thì
 * nhân Linux bỏ qua SIGTERM, nên `docker stop` không làm gì: Docker chờ 10 giây
 * rồi SIGKILL, request đang chạy bị cắt ngang. Caddy thì vẫn đẩy request vào bản
 * đó tới lượt kiểm sức khoẻ kế tiếp (10 giây một lượt, Caddyfile `ban_api`).
 * Trước đây deploy tạo lại cả ba bản cùng lúc nên chuyện này chìm trong khoảng
 * 502 lớn hơn; khởi động lại lần lượt thì nó là chỗ hở còn lại.
 *
 * BA BƯỚC KHI NHẬN SIGTERM.
 *  1. `GET /` (đường caddy kiểm sức khoẻ) trả 503: trong tối đa 13 giây (10 giây
 *     một lượt + 3 giây chờ) caddy rút bản này khỏi đội.
 *  2. Request thật vẫn được phục vụ, thêm `Connection: close` để caddy không
 *     giữ kết nối cũ sang bản sắp tắt.
 *  3. Chờ `CHO_MS` cho caddy rút xong, đóng app (Nest gọi các hook tắt, server
 *     chờ request dở chạy nốt), rồi thoát 0. Tổng thời gian dưới
 *     `stop_grace_period` của api trong docker-compose.yml.
 *
 * Tham số thứ hai chỉ để bài kiểm thay `process`, đồng hồ và `process.exit`.
 */
export const CHO_MS = 15_000;
const TRAN_DONG_MS = 15_000;

export function ganTatEm(
  dong: () => Promise<void>,
  boCuc: {
    tienTrinh?: Pick<EventEmitter, 'on'>;
    logger?: { log: (message: string) => void };
    cho?: (ms: number) => Promise<void>;
    thoat?: (ma: number) => void;
  } = {},
): {
  chanKhiTat: (req: Request, res: Response, next: NextFunction) => void;
} {
  const tienTrinh = boCuc.tienTrinh ?? process;
  const logger = boCuc.logger ?? new Logger('tat-em');
  const cho =
    boCuc.cho ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const thoat = boCuc.thoat ?? ((ma: number) => process.exit(ma));
  let dangTat = false;

  tienTrinh.on('SIGTERM', () => {
    if (dangTat) return;
    dangTat = true;
    logger.log(`nhận SIGTERM: rút khỏi caddy, ${CHO_MS / 1000} giây nữa đóng`);
    void (async () => {
      await cho(CHO_MS);
      // Kết nối socket.io hay request treo có thể giữ server mãi: quá trần thì
      // thoát luôn, đằng nào Docker cũng SIGKILL khi hết stop_grace_period.
      const tran = setTimeout(() => thoat(0), TRAN_DONG_MS);
      tran.unref?.();
      try {
        await dong();
      } catch (e) {
        logger.log(`đóng app lỗi, vẫn thoát: ${(e as Error)?.message ?? e}`);
      }
      clearTimeout(tran);
      thoat(0);
    })();
  });

  return {
    chanKhiTat: (req, res, next) => {
      if (!dangTat) return next();
      if (req.method === 'GET' && req.path === '/') {
        res.status(503).send('dang tat');
        return;
      }
      res.setHeader('Connection', 'close');
      next();
    },
  };
}
