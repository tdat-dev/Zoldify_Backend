import express from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ganTinProxy } from './tin-proxy';

/**
 * `req.ip` (và vì thế khoá đếm của ThrottlerGuard) phải là IP người dùng thật.
 *
 * Đo trên production trước khi sửa: chuỗi đường đi là
 *   khách -> Cloudflare -> nginx máy chủ -> Caddy (container) -> 3 bản api
 * Caddy không khai `trusted_proxies` nên thay X-Forwarded-For bằng IP của
 * chặng trước nó (cổng docker, 172.18.0.1), còn `trust proxy 1` lấy đúng
 * chặng cuối đó. Kết quả: CẢ TRANG dùng chung một xô 10 req/s; một máy gửi
 * 4 req/s nhận 429 cho cả 12 request vì máy chủ cùng lúc gửi ~20 req/s.
 *
 * Bài kiểm dựng một request Express thật (getter `req.ip` của chính Express,
 * không chép lại thuật toán) với socket ngang hàng và header tuỳ ý.
 */
function taoReq(peer: string, xff?: string): express.Request {
  const app = express();
  ganTinProxy(app);
  const req = Object.create(app.request) as express.Request;
  const socket = { remoteAddress: peer };
  Object.defineProperty(req, 'app', { value: app });
  Object.defineProperty(req, 'headers', {
    value: xff ? { 'x-forwarded-for': xff } : {},
  });
  Object.defineProperty(req, 'socket', { value: socket });
  Object.defineProperty(req, 'connection', { value: socket });
  return req;
}

function ipCua(peer: string, xff?: string): string | undefined {
  return taoReq(peer, xff).ip;
}

/** Khoá ThrottlerGuard thật sự dùng: `getTracker` mặc định của thư viện. */
async function khoaDem(peer: string, xff?: string): Promise<string> {
  const req = taoReq(peer, xff);
  const getTracker = (
    ThrottlerGuard.prototype as unknown as {
      getTracker: (r: unknown) => Promise<string>;
    }
  ).getTracker;
  return getTracker.call(null, req);
}

describe('tin proxy: req.ip là IP người dùng thật', () => {
  it('qua nginx + Caddy (socket là Caddy trong mạng docker): lấy IP khách', () => {
    // nginx đặt XFF = IP khách; Caddy tin nginx (cổng docker) nên nối thêm.
    expect(ipCua('172.18.0.5', '203.0.113.7, 172.18.0.1')).toBe('203.0.113.7');
  });

  it('khoá của ThrottlerGuard cũng là IP khách', async () => {
    await expect(
      khoaDem('172.18.0.5', '203.0.113.7, 172.18.0.1'),
    ).resolves.toBe('203.0.113.7');
  });

  it('khách tự gửi XFF giả ở đầu chuỗi: vẫn lấy IP thật do proxy ghi', () => {
    expect(ipCua('172.18.0.5', '1.2.3.4, 203.0.113.7, 172.18.0.1')).toBe(
      '203.0.113.7',
    );
  });

  it('socket công khai (không phải proxy của ta) thì bỏ qua XFF hoàn toàn', () => {
    expect(ipCua('198.51.100.20', '1.2.3.4')).toBe('198.51.100.20');
    expect(ipCua('198.51.100.20', '10.0.0.1')).toBe('198.51.100.20');
  });

  it('gọi thẳng từ loopback không qua proxy: giữ 127.0.0.1 (cửa /api/docs)', () => {
    expect(ipCua('127.0.0.1')).toBe('127.0.0.1');
  });
});
