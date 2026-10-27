jest.mock('./json-logger', () => ({ ghiDongLog: jest.fn() }));

import type { Request, Response } from 'express';
import { ghiDongLog } from './json-logger';
import { RequestIdMiddleware } from './request-id.middleware';

/**
 * Dòng log mỗi request ghi `req.originalUrl` NGUYÊN VẸN, kể cả chuỗi truy vấn.
 *
 * Webhook GHN mang bí mật ngay trong URL (`?token=...`, GHN không cho đặt
 * header riêng, xem shipment-tracking.service.ts). Nên mỗi lần GHN gọi là bí
 * mật đó nằm trong log JSON, đi theo log sang mọi chỗ log được gửi tới (máy
 * chủ log, bản sao lưu, người được xem log). Ai đọc được log là giả được
 * webhook. Cùng chuyện với `checksum`/`signature` của các cổng thanh toán.
 */
describe('Log request che bí mật trong chuỗi truy vấn', () => {
  function ghiMotLuot(url: string): string {
    (ghiDongLog as jest.Mock).mockClear();
    let xong: () => void = () => undefined;
    const res = {
      statusCode: 200,
      setHeader: () => undefined,
      on: (ev: string, fn: () => void) => {
        if (ev === 'finish') xong = fn;
      },
    } as unknown as Response;
    const req = {
      header: () => undefined,
      method: 'POST',
      originalUrl: url,
    } as unknown as Request;

    new RequestIdMiddleware().use(req, res, () => undefined);
    xong();
    const goi = (ghiDongLog as jest.Mock<void, [{ path: string }]>).mock.calls;
    const dong = goi[0][0];
    return dong.path;
  }

  it('token của webhook GHN không vào log', () => {
    const p = ghiMotLuot('/api/v1/orders/ghn-webhook?token=BI-MAT-123&a=1');
    expect(p).not.toContain('BI-MAT-123');
    // Vẫn biết là request có gửi token và các tham số khác còn nguyên.
    expect(p).toMatch(/token=/);
    expect(p).toContain('a=1');
    expect(p.startsWith('/api/v1/orders/ghn-webhook?')).toBe(true);
  });

  it('checksum, signature và kiểu viết hoa cũng bị che', () => {
    const p = ghiMotLuot('/api/v1/x?Token=T1&checksum=C2&signature=S3&page=2');
    for (const bi of ['T1', 'C2', 'S3']) expect(p).not.toContain(bi);
    expect(p).toContain('page=2');
  });

  it('URL không có gì nhạy cảm thì giữ nguyên', () => {
    expect(ghiMotLuot('/api/v1/products?page=2&limit=20')).toBe(
      '/api/v1/products?page=2&limit=20',
    );
    expect(ghiMotLuot('/api/v1/products/5')).toBe('/api/v1/products/5');
  });
});
