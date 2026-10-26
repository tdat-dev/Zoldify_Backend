import { NotFoundException } from '@nestjs/common';
import type { IUser } from '@identity/users/users.interface';
import { PayosService } from './payos.service';

/**
 * GET /payos/order/:orderId không kiểm quyền (IDOR).
 *
 * Route chỉ có JwtAuthGuard, nên ai đăng nhập cũng hỏi được trạng thái thanh
 * toán của đơn người khác: đã trả chưa, trả lúc nào, trạng thái đơn, và
 * payos_order_code. id đơn là số tăng dần nên quét được cả bảng. Hai route
 * anh em (status/:code, refresh/:orderId) đã kiểm chủ từ trước, riêng route
 * này sót.
 *
 * Người lạ nhận 404 chứ không 403: giống findOneForActor của OrdersService,
 * không xác nhận cho người lạ là đơn đó có tồn tại.
 */
type XemTrangThai = {
  getOrderStatus(orderId: number, user: IUser): Promise<{ orderId: number }>;
};

function dung() {
  const order = { id: 5, user: { id: 2 }, is_paid: false, status: 'pending' };
  const orderRepository = {
    findOne: jest.fn(() => Promise.resolve(order)),
  };
  const paymentRepository = {
    findOne: jest.fn(() => Promise.resolve(null)),
  };
  const service = new PayosService(
    {
      get: (k: string) => (k === 'PAYOS_CHECKSUM_KEY' ? 'khoa' : 'x'),
    } as never,
    {} as never,
    paymentRepository as never,
    orderRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc: service as unknown as XemTrangThai };
}

describe('GET /payos/order/:orderId chỉ cho người mua của đơn hoặc admin', () => {
  it('người lạ nhận 404', async () => {
    const { svc } = dung();
    await expect(
      svc.getOrderStatus(5, { id: 99, role: 'buyer' } as IUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('người mua của đơn xem được', async () => {
    const { svc } = dung();
    const res = await svc.getOrderStatus(5, { id: 2, role: 'buyer' } as IUser);
    expect(res.orderId).toBe(5);
  });

  it('admin xem được', async () => {
    const { svc } = dung();
    const res = await svc.getOrderStatus(5, { id: 1, role: 'admin' } as IUser);
    expect(res.orderId).toBe(5);
  });
});
