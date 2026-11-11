import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { EventEmitter } from 'node:events';

/**
 * Tắt api mà không làm rơi request nào, để deploy khởi động lại lần lượt từng
 * bản (`scripts/deploy/lan-luot-api.sh`) mà caddy không trả 502.
 *
 * VÌ SAO CẦN. Node chạy là PID 1 trong container. PID 1 không có bộ bắt thì
 * nhân Linux bỏ qua SIGTERM, nên `docker stop` không làm gì: Docker chờ hết hạn
 * rồi SIGKILL, request đang chạy bị cắt ngang.
 *
 * VÌ SAO KHÔNG TRẢ 503 CHO CADDY RÚT RA. Caddy không chạy kiểm sức khoẻ chủ động
 * với upstream `dynamic a` (tài liệu reverse_proxy nói rõ; cụm thử 11/11 không
 * có một dòng log kiểm nào, kể cả khi bản api đã chết). Bản đang tắt vẫn còn
 * trong DNS nên caddy vẫn chia request cho nó tới lúc nó đóng cổng. Bản đầu
 * của file này trả 503 ở `GET /` và cụm thử vẫn dính một 502: caddy gửi POST
 * vào một kết nối rảnh đúng lúc server đóng nó, và không thử lại POST đã gửi.
 *
 * NÊN LÀM HAI BƯỚC KHI NHẬN SIGTERM.
 *  1. Mọi response kèm `Connection: close`: caddy đóng kết nối sau response đó
 *     thay vì để vào bể dùng lại. Kết nối rảnh sẵn trong bể thì caddy tự bỏ
 *     sau `keepalive 5s` (Caddyfile). Chờ `CHO_MS`, lâu hơn hạn đó, để không
 *     còn kết nối cũ nào tới bản này.
 *  2. Đóng app: server thôi nhận kết nối, request dở chạy nốt, Nest gọi các
 *     hook tắt. Từ đây caddy nối vào là bị từ chối ngay, và nối hỏng thì caddy
 *     thử bản khác (`lb_try_duration`) vì request chưa gửi đi, kể cả POST.
 * Tổng thời gian dưới `stop_grace_period` của api trong docker-compose.yml.
 *
 * Tham số thứ hai chỉ để bài kiểm thay `process`, đồng hồ và `process.exit`.
 */
export const CHO_MS = 10_000;
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
    logger.log(
      `nhận SIGTERM: bỏ kết nối giữ lại, ${CHO_MS / 1000} giây nữa đóng`,
    );
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
    chanKhiTat: (_req, res, next) => {
      if (dangTat) res.setHeader('Connection', 'close');
      next();
    },
  };
}
