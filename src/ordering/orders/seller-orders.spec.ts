import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderStatus } from './entities/order.entity';

/**
 * Lỗi H-02 của đợt test E2E Android 30/09 — bài kiểm viết TRƯỚC.
 *
 * Người mua đặt đơn xong, người bán KHÔNG biết: backend chỉ tạo thông báo cho
 * người mua, không có dòng nào cho người bán, nên cũng không có push. Và người
 * bán mở chi tiết đơn của chính mình thì nhận 404, vì findOne chỉ cho người mua
 * (và admin) xem. App không làm được màn "Đơn bán" khi API đóng cửa như vậy.
 *
 * Repo giả, không cần MySQL. Repo đơn giả TÔN TRỌNG điều kiện `where.user` để
 * bài kiểm đỏ thật với code cũ, không xanh nhờ mock bỏ qua bộ lọc.
 */

const BUYER = { id: 2, role: 'buyer' };
const SELLER_A = { id: 11, full_name: 'Người bán A' };
const SELLER_B = { id: 12, full_name: 'Người bán B' };
const STRANGER = { id: 99, role: 'buyer' };

function order() {
  return {
    id: 77,
    order_code: 'ORD-TEST-001',
    status: OrderStatus.PENDING,
    user: BUYER,
    items: [
      {
        id: 1,
        quantity: 1,
        subtotal: '100000',
        product: { id: 5, seller: SELLER_A },
      },
      {
        id: 2,
        quantity: 2,
        subtotal: '300000',
        product: { id: 6, seller: SELLER_B },
      },
    ],
  };
}

/** EntityManager giả đủ cho transaction tạo đơn: khoá hàng, lưu, trừ kho, xoá giỏ. */
function fakeEm() {
  const qb: Record<string, unknown> = {};
  for (const m of [
    'setLock',
    'where',
    'orderBy',
    'update',
    'set',
    'andWhere',
  ]) {
    qb[m] = () => qb;
  }
  qb.getMany = () =>
    Promise.resolve([
      { id: 5, stock: 10 },
      { id: 6, stock: 10 },
    ]);
  qb.execute = () => Promise.resolve({ affected: 1 });
  return {
    createQueryBuilder: () => qb,
    save: (_entity: unknown, x: unknown) =>
      Promise.resolve(Array.isArray(x) ? x : { ...(x as object), id: 77 }),
    delete: () => Promise.resolve({}),
  };
}

function makeService() {
  const o = order();
  const repo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    create: jest.fn((x: unknown) => x),
  });
  const orderRepo = repo();
  orderRepo.findOne.mockImplementation(
    ({ where }: { where: { id: number; user?: { id: number } } }) =>
      Promise.resolve(
        where.id === o.id && (!where.user || where.user.id === o.user.id)
          ? o
          : null,
      ),
  );
  const cartRepo = repo();
  cartRepo.find.mockResolvedValue([
    {
      id: 1,
      quantity: 1,
      product: {
        id: 5,
        name: 'Áo',
        price: '100000',
        stock: 10,
        currency: 'VND',
        seller: SELLER_A,
      },
    },
    {
      id: 2,
      quantity: 2,
      product: {
        id: 6,
        name: 'Quần',
        price: '150000',
        stock: 10,
        currency: 'VND',
        seller: SELLER_B,
      },
    },
  ]);
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const dataSource = {
    transaction: (cb: (em: unknown) => Promise<unknown>) => cb(fakeEm()),
  };
  const svc = new OrdersService(
    orderRepo as never,
    repo() as never,
    repo() as never,
    repo() as never,
    cartRepo as never,
    repo() as never,
    repo() as never,
    notifications as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
  );
  return { svc, notifications };
}

describe('H-02: người bán được báo khi có đơn mới', () => {
  it('đặt đơn hai người bán: MỖI người bán nhận một thông báo (kèm push)', async () => {
    const { svc, notifications } = makeService();

    await svc.create(
      {
        receiver_name: 'Người mua',
        receiver_phone: '0901234567',
        shipping_address: '12 Đường Test',
      },
      BUYER as never,
    );

    const toUsers = notifications.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { user_id: number }).user_id,
    );
    expect(toUsers).toEqual(expect.arrayContaining([SELLER_A.id, SELLER_B.id]));
    // Người mua vẫn nhận thông báo "Đặt hàng thành công" như cũ.
    expect(toUsers).toContain(BUYER.id);
  });
});

describe('H-02: người bán xem được chi tiết đơn có hàng của mình', () => {
  it('người bán của một món trong đơn mở được chi tiết đơn', async () => {
    const { svc } = makeService();
    const o = await svc.findOne(77, SELLER_A as never);
    expect(o?.id).toBe(77);
  });

  it('người không liên quan vẫn nhận 404', async () => {
    const { svc } = makeService();
    await expect(svc.findOne(77, STRANGER as never)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('H-02: mở quyền XEM cho người bán không được mở quyền của người mua', () => {
  // cancel() (huỷ phía người mua) và remove() (xoá mềm đơn) từng dựa vào
  // findOne để kiểm quyền. findOne giờ cho người bán xem, nên hai đường này
  // phải tự kiểm lại: người bán có đường riêng là cancel-sale.
  it('người bán KHÔNG gọi được đường huỷ của người mua', async () => {
    const { svc } = makeService();
    await expect(svc.cancel(77, SELLER_A as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('người bán KHÔNG xoá được đơn', async () => {
    const { svc } = makeService();
    await expect(svc.remove(77, SELLER_A as never)).rejects.toThrow(
      NotFoundException,
    );
  });
});
