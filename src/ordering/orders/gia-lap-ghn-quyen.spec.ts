import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderStatus } from './entities/order.entity';
import { ShipmentStatus } from './entities/order-shipment.entity';

/**
 * PATCH /orders/:id/sim-ghn: người bán tự đánh dấu "đã giao" rồi nhận tiền.
 *
 * Trình giả lập GHN có lý do tồn tại (GHN sandbox không có shipper thật, nhóm
 * dùng để demo). Nhưng bản trước cho NGƯỜI BÁN gọi phase "delivered": vận đơn
 * thành DELIVERED, và cron chốt vận đơn sau đó giải ngân ký quỹ cho người bán,
 * trong khi chưa có món hàng nào rời khỏi nhà. Cổng duy nhất là GHN_HOST chứa
 * "dev-online-gateway", tức mọi máy chạy sandbox (staging, demo) đều mở.
 *
 * Ai gọi phase nào (kiểm 25/10):
 *   - Admin web, trang Đơn hàng: "shipping" và "delivered".
 *   - App người bán: chỉ "shipping".
 * Nên: "delivered" chỉ admin, chỉ cho đơn ĐANG GIAO; "shipping" giữ cho người
 * bán của đơn hoặc admin; thêm công tắc GHN_SIMULATOR on/off.
 */
const khoPhat = { phat: () => Promise.resolve() } as never;
const SELLER = { id: 11, role: 'seller' };
const ADMIN = { id: 1, role: 'admin' };
const SANDBOX = 'https://dev-online-gateway.ghn.vn/shiip/public-api/v2';
const PROD = 'https://online-gateway.ghn.vn/shiip/public-api/v2';

function donHang(status: OrderStatus) {
  return {
    id: 7,
    status,
    user: { id: 2 },
    items: [{ product: { id: 5, seller: { id: SELLER.id } } }],
  };
}

function dung(status: OrderStatus) {
  const repo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    create: jest.fn((x: unknown) => x),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  });
  const orderRepo = repo();
  const shipmentRepo = repo();
  orderRepo.findOne.mockResolvedValue(donHang(status));
  shipmentRepo.find.mockResolvedValue([
    { id: 3, seller: { id: SELLER.id }, status: ShipmentStatus.CREATED },
  ]);
  const svc = new OrdersService(
    orderRepo as never,
    repo() as never,
    shipmentRepo as never,
    repo() as never,
    repo() as never,
    repo() as never,
    repo() as never,
    { create: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { transaction: jest.fn() } as never,
    khoPhat,
  );
  return { svc, orderRepo, shipmentRepo };
}

describe('Giả lập GHN: ai được gọi phase nào', () => {
  const cu = { host: process.env.GHN_HOST, sim: process.env.GHN_SIMULATOR };
  beforeEach(() => {
    process.env.GHN_HOST = SANDBOX;
    delete process.env.GHN_SIMULATOR;
  });
  afterAll(() => {
    if (cu.host === undefined) delete process.env.GHN_HOST;
    else process.env.GHN_HOST = cu.host;
    if (cu.sim === undefined) delete process.env.GHN_SIMULATOR;
    else process.env.GHN_SIMULATOR = cu.sim;
  });

  it('người bán KHÔNG được gọi "delivered"', async () => {
    const { svc, shipmentRepo } = dung(OrderStatus.SHIPPING);
    await expect(
      svc.simulateGhnStatus(7, 'delivered', SELLER as never),
    ).rejects.toThrow(ForbiddenException);
    expect(shipmentRepo.save).not.toHaveBeenCalled();
  });

  it('admin gọi "delivered" cho đơn đang giao thì vận đơn thành DELIVERED', async () => {
    const { svc, shipmentRepo } = dung(OrderStatus.SHIPPING);
    await svc.simulateGhnStatus(7, 'delivered', ADMIN as never);
    expect(shipmentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ShipmentStatus.DELIVERED }),
    );
  });

  it.each([OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.CONFIRMED])(
    'admin gọi "delivered" cho đơn %s thì bị từ chối',
    async (status) => {
      const { svc, shipmentRepo } = dung(status);
      await expect(
        svc.simulateGhnStatus(7, 'delivered', ADMIN as never),
      ).rejects.toThrow(BadRequestException);
      expect(shipmentRepo.save).not.toHaveBeenCalled();
    },
  );

  it('người bán vẫn gọi được "shipping" (app người bán dùng)', async () => {
    const { svc } = dung(OrderStatus.CONFIRMED);
    const res = await svc.simulateGhnStatus(7, 'shipping', SELLER as never);
    expect(res).toEqual(
      expect.objectContaining({ status: OrderStatus.SHIPPING }),
    );
  });

  it('GHN_SIMULATOR=off tắt hẳn, kể cả trên sandbox', async () => {
    process.env.GHN_SIMULATOR = 'off';
    const { svc } = dung(OrderStatus.CONFIRMED);
    await expect(
      svc.simulateGhnStatus(7, 'shipping', SELLER as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('GHN_SIMULATOR=on bật tường minh dù GHN_HOST không phải sandbox', async () => {
    process.env.GHN_SIMULATOR = 'on';
    process.env.GHN_HOST = PROD;
    const { svc } = dung(OrderStatus.CONFIRMED);
    const res = await svc.simulateGhnStatus(7, 'shipping', SELLER as never);
    expect(res).toEqual(
      expect.objectContaining({ status: OrderStatus.SHIPPING }),
    );
  });

  it('không đặt GHN_SIMULATOR và GHN_HOST thật thì tắt như cũ', async () => {
    process.env.GHN_HOST = PROD;
    const { svc } = dung(OrderStatus.CONFIRMED);
    await expect(
      svc.simulateGhnStatus(7, 'shipping', SELLER as never),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('PATCH /orders/:id/sim-ghn có DTO', () => {
  it('phase ngoài shipping/delivered bị từ chối', async () => {
    const kieu = Reflect.getMetadata(
      'design:paramtypes',
      OrdersController.prototype,
      'simGhn',
    ) as Array<new () => object>;
    expect(kieu[1]).not.toBe(Object);

    const loi = await validate(plainToInstance(kieu[1], { phase: 'xoa-don' }));
    expect(loi.length).toBeGreaterThan(0);
    const dung = await validate(
      plainToInstance(kieu[1], { phase: 'shipping' }),
    );
    expect(dung).toHaveLength(0);
  });
});
