import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { OrdersService } from './orders.service';
import { OrderStatus } from './entities/order.entity';
import { ShipmentStatus } from './entities/order-shipment.entity';
import { GhnService } from '@ordering/ghn/ghn.service';

/**
 * Lỗi H-07 / H-08 của đợt test E2E Android 30/09 — bài kiểm viết TRƯỚC.
 *
 * Chuyện đã xảy ra trên prod: người mua ở Văn Giang (Hưng Yên) đặt đơn, app hiện
 * phí ship "Miễn phí". Người bán xác nhận, GHN trả 400, vận đơn lưu lỗi đúng một
 * câu "Request failed with status code 400". Rồi nút giả lập GHN vẫn đẩy đơn sang
 * "Đang giao", người mua bấm "Đã nhận hàng" thì bị server từ chối.
 *
 * Gốc: GHN đánh dấu quận 2045 Văn Giang là Status=2, SupportType=0 (ngừng phục
 * vụ). Hỏi available-services từ/tới quận đó ra mảng rỗng, tính phí ném lỗi, và
 * mọi tầng phía trên đều nuốt lỗi thành số 0 hoặc câu vô nghĩa.
 *
 * Bài kiểm dùng repo giả, không cần MySQL: mọi quyết định ở đây xảy ra TRƯỚC
 * transaction tạo đơn, hoặc chỉ đụng một dòng vận đơn.
 */

/** Lỗi axios thật mà GHN sinh ra: message chung chung, lý do nằm trong body. */
function ghnAxiosError(reason: string) {
  return Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    response: { status: 400, data: { code: 400, message: reason } },
  });
}

const SELLER = { id: 11, full_name: 'Người bán' };
const BUYER = { id: 2 };
const LY_DO_GHN = 'Không tìm thấy thông tin quận. Vui lòng thử lại sau.';

function makeService(ghn: Partial<Record<keyof GhnService, jest.Mock>>) {
  const cartItems = [
    {
      id: 1,
      quantity: 1,
      product: {
        id: 5,
        name: 'Máy ảnh',
        price: '2490000.00',
        stock: 3,
        currency: 'VND',
        seller: SELLER,
      },
    },
  ];
  const repo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    create: jest.fn((x: unknown) => x),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  });
  const orderRepo = repo();
  const shipmentRepo = repo();
  const shopRepo = repo();
  const cartRepo = repo();
  cartRepo.find.mockResolvedValue(cartItems);
  shopRepo.find.mockResolvedValue([
    {
      id: 1,
      name: 'Shop Test',
      user: SELLER,
      pickup_district_id: 2045,
      pickup_ward_code: '221011',
      pickup_ward_name: 'Xã Xuân Quan',
      pickup_district_name: 'Huyện Văn Giang',
      pickup_province_name: 'Hưng Yên',
      pickup_address: '34 Đường Shop',
      pickup_name: 'Shop Test',
      pickup_phone: '0912345678',
    },
  ]);
  // Đi tới đây nghĩa là đã quyết định tạo đơn: báo thẳng ra thay vì để mock
  // rỗng gây TypeError khó đọc.
  const dataSource = {
    transaction: jest
      .fn()
      .mockRejectedValue(new Error('ĐÃ MỞ TRANSACTION TẠO ĐƠN')),
  };

  const svc = new OrdersService(
    orderRepo as never,
    repo() as never,
    shipmentRepo as never,
    shopRepo as never,
    cartRepo as never,
    repo() as never,
    repo() as never,
    { create: jest.fn() } as never,
    ghn as never,
    {} as never,
    {} as never,
    {} as never,
    dataSource as never,
  );
  return { svc, orderRepo, shipmentRepo, dataSource };
}

function confirmedOrder() {
  return {
    id: 7,
    status: OrderStatus.CONFIRMED,
    payment_method: 'cod',
    receiver_name: 'Người mua',
    receiver_phone: '0901234567',
    shipping_address: '12 Đường Test',
    ghn_district_id: 1680,
    ghn_ward_code: '220117',
    user: BUYER,
    items: [
      {
        product_name: 'Máy ảnh',
        price: '2490000.00',
        subtotal: '2490000.00',
        quantity: 1,
        product: { id: 5, seller: SELLER },
      },
    ],
  };
}

describe('H-07: phí ship không tính được thì KHÔNG được thành 0đ', () => {
  it('tạo đơn bị từ chối rõ ràng, không lặng lẽ ghi phí ship 0', async () => {
    const { svc, dataSource } = makeService({
      calculateFee: jest.fn().mockRejectedValue(ghnAxiosError(LY_DO_GHN)),
    });

    await expect(
      svc.create(
        {
          receiver_name: 'Người mua',
          receiver_phone: '0901234567',
          shipping_address: '12 Đường Test',
          ghn_district_id: 2045,
          ghn_ward_code: '221011',
        },
        BUYER as never,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.create(
        {
          receiver_name: 'Người mua',
          receiver_phone: '0901234567',
          shipping_address: '12 Đường Test',
          ghn_district_id: 2045,
          ghn_ward_code: '221011',
        },
        BUYER as never,
      ),
    ).rejects.toThrow(/phí vận chuyển/);
    // Chưa mở transaction nào: không có đơn nào được ghi.
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('báo giá nói rõ là CHƯA tính được, kèm lý do của GHN', async () => {
    const { svc } = makeService({
      calculateFee: jest.fn().mockRejectedValue(ghnAxiosError(LY_DO_GHN)),
    });

    const quote = await svc.getShippingQuote(BUYER.id, {
      to_district_id: 2045,
      to_ward_code: '221011',
    });

    expect(quote.ok).toBe(false);
    expect(quote.items[0].error).toContain(LY_DO_GHN);
  });
});

describe('H-07: vận đơn lỗi phải giữ lý do của GHN và tạo lại được', () => {
  it('tạo lại vận đơn FAILED: cập nhật đúng dòng cũ, không sinh dòng trùng', async () => {
    const createOrder = jest.fn().mockResolvedValue({ order_code: 'L8NABC' });
    const { svc, orderRepo, shipmentRepo } = makeService({ createOrder });
    orderRepo.findOne.mockResolvedValue(confirmedOrder());
    const failed = {
      id: 3,
      seller: SELLER,
      status: ShipmentStatus.FAILED,
      error: 'Request failed with status code 400',
    };
    shipmentRepo.find.mockResolvedValue([failed]);

    await svc.retryGhnShipments(7, SELLER as never);

    expect(createOrder).toHaveBeenCalledTimes(1);
    const saved = shipmentRepo.save.mock.calls.map(
      (c) => c[0] as { id: number },
    );
    expect(saved).toContainEqual(
      expect.objectContaining({
        id: 3,
        status: ShipmentStatus.CREATED,
        tracking_code: 'L8NABC',
      }),
    );
    expect(saved.every((s) => s.id === 3)).toBe(true);
  });

  it('GHN vẫn từ chối: dòng vận đơn lưu lý do thật, không phải câu của axios', async () => {
    const createOrder = jest.fn().mockRejectedValue(ghnAxiosError(LY_DO_GHN));
    const { svc, orderRepo, shipmentRepo } = makeService({ createOrder });
    orderRepo.findOne.mockResolvedValue(confirmedOrder());
    shipmentRepo.find.mockResolvedValue([
      { id: 3, seller: SELLER, status: ShipmentStatus.FAILED, error: 'x' },
    ]);

    await svc.retryGhnShipments(7, SELLER as never);

    const saved = shipmentRepo.save.mock.calls.map(
      (c) => c[0] as { id: number },
    );
    expect(saved).toContainEqual(
      expect.objectContaining({
        id: 3,
        status: ShipmentStatus.FAILED,
        error: expect.stringContaining(LY_DO_GHN) as unknown,
      }),
    );
  });

  it('hai lần tạo lại cùng lúc (bấm đúp) chỉ gọi GHN MỘT lần', async () => {
    // Cả hai yêu cầu cùng đọc thấy một dòng FAILED. Không có chốt thì cả hai
    // cùng gọi GHN: GHN tạo HAI vận đơn thật, dòng của ta chỉ giữ một mã, vận
    // đơn kia mồ côi mà vẫn đi lấy hàng, thu hộ. Chốt là câu UPDATE có điều
    // kiện: chỉ một yêu cầu đổi được dòng, yêu cầu kia thấy affected = 0.
    const createOrder = jest.fn().mockResolvedValue({ order_code: 'L8NABC' });
    const { svc, orderRepo, shipmentRepo } = makeService({ createOrder });
    orderRepo.findOne.mockResolvedValue(confirmedOrder());
    shipmentRepo.find.mockResolvedValue([
      { id: 3, seller: SELLER, status: ShipmentStatus.FAILED, error: 'x' },
    ]);
    shipmentRepo.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });

    await Promise.all([
      svc.retryGhnShipments(7, SELLER as never),
      svc.retryGhnShipments(7, SELLER as never),
    ]);

    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});

describe('H-08: chưa có vận đơn hợp lệ thì đơn KHÔNG được sang "Đang giao"', () => {
  const oldHost = process.env.GHN_HOST;
  beforeAll(() => {
    process.env.GHN_HOST =
      'https://dev-online-gateway.ghn.vn/shiip/public-api/v2';
  });
  afterAll(() => {
    process.env.GHN_HOST = oldHost;
  });

  it('giả lập GHN "đang giao" bị chặn khi vận đơn của người bán FAILED', async () => {
    const { svc, orderRepo, shipmentRepo } = makeService({});
    orderRepo.findOne.mockResolvedValue(confirmedOrder());
    shipmentRepo.find.mockResolvedValue([
      { id: 3, seller: SELLER, status: ShipmentStatus.FAILED },
    ]);

    await expect(
      svc.simulateGhnStatus(7, 'shipping', SELLER as never),
    ).rejects.toThrow(BadRequestException);
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('giả lập GHN "đang giao" chạy khi mọi người bán đã có vận đơn', async () => {
    const { svc, orderRepo, shipmentRepo } = makeService({});
    orderRepo.findOne.mockResolvedValue(confirmedOrder());
    shipmentRepo.find.mockResolvedValue([
      { id: 3, seller: SELLER, status: ShipmentStatus.CREATED },
    ]);

    const res = await svc.simulateGhnStatus(7, 'shipping', SELLER as never);
    expect(res.status).toBe(OrderStatus.SHIPPING);
  });
});

describe('GHN: không cho chọn quận/phường mà GHN đã ngừng phục vụ', () => {
  function ghnWith(data: unknown[]) {
    const http = { post: jest.fn(() => of({ data: { data } })) };
    return new GhnService(http as never);
  }

  it('bỏ quận Status khác 1 hoặc SupportType 0 (vd 2045 Văn Giang)', async () => {
    const ghn = ghnWith([
      {
        DistrictID: 1680,
        DistrictName: 'Thành phố Hưng Yên',
        Status: 1,
        SupportType: 3,
      },
      {
        DistrictID: 2045,
        DistrictName: 'Huyện Văn Giang',
        Status: 2,
        SupportType: 0,
      },
      {
        DistrictID: 3766,
        DistrictName: 'Thị xã Chũ',
        Status: 3,
        SupportType: 0,
      },
    ]);
    const ds = (await ghn.getDistricts(268)) as Array<{ DistrictID: number }>;
    expect(ds.map((d) => d.DistrictID)).toEqual([1680]);
  });

  it('bỏ phường ngừng phục vụ', async () => {
    const ghn = ghnWith([
      {
        WardCode: '220117',
        WardName: 'Xã Trung Nghĩa',
        Status: 1,
        SupportType: 3,
      },
      {
        WardCode: '910138',
        WardName: 'Xã Phương Nam',
        Status: 3,
        SupportType: 0,
      },
    ]);
    const ws = (await ghn.getWards(1680)) as Array<{ WardCode: string }>;
    expect(ws.map((w) => w.WardCode)).toEqual(['220117']);
  });
});

describe('GHN: không có tuyến giao thì báo lý do đọc được', () => {
  it('available-services trả data null (không phải mảng rỗng) vẫn ra câu dễ hiểu', async () => {
    // Đo live trên staging 05/10: GHN trả { code: 200, data: null } cho quận
    // 2045. Code cũ gọi null.find() và người mua đọc thấy
    // "Cannot read properties of null (reading 'find')".
    const http = {
      post: jest.fn(() => of({ data: { code: 200, data: null } })),
    };
    const ghn = new GhnService(http as never);
    await expect(
      ghn.calculateFee({
        to_district_id: 2045,
        to_ward_code: '221011',
        weight: 200,
      }),
    ).rejects.toThrow(/không có tuyến/);
  });
});

describe('GHN: tạo lại sau timeout không được sinh vận đơn trùng', () => {
  // Test máy ảo 05/10: GHN sandbox timeout ở phía họ ("context deadline
  // exceeded") nhưng request vẫn chạy tiếp; bấm tạo lại thì GHN trả "Too many
  // request. This request is processing". Timeout KHÔNG có nghĩa là chưa tạo.
  // Đo trên sandbox: gửi lại cùng client_order_code thì GHN trả ĐÚNG vận đơn
  // cũ (L8AR8L hai lần), nên mã cố định theo (đơn, người bán) là đủ chống trùng.
  it('mỗi lần tạo (kể cả tạo lại) gửi cùng client_order_code theo đơn và người bán', async () => {
    const createOrder = jest.fn().mockResolvedValue({ order_code: 'L8NABC' });
    const { svc, orderRepo, shipmentRepo } = makeService({ createOrder });
    orderRepo.findOne.mockResolvedValue({
      ...confirmedOrder(),
      order_code: 'ORD-20261005-389',
    });
    shipmentRepo.find.mockResolvedValue([
      { id: 3, seller: SELLER, status: ShipmentStatus.FAILED, error: 'x' },
    ]);

    await svc.retryGhnShipments(7, SELLER as never);

    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        client_order_code: `ORD-20261005-389-${SELLER.id}`,
      }),
    );
  });

  it('GhnService gửi client_order_code trong body tạo vận đơn', async () => {
    const http = {
      post: jest.fn(() => of({ data: { data: { order_code: 'L8NABC' } } })),
    };
    const ghn = new GhnService(http as never);
    await ghn.createOrder({
      client_order_code: 'ORD-1-11',
      to_name: 'A',
      to_phone: '0901234567',
      to_address: 'x',
      to_ward_code: '220117',
      to_district_id: 1680,
      weight: 200,
      cod_amount: 0,
      items: [{ name: 'a', quantity: 1, weight: 200, price: 1000 }],
    });
    const body = (http.post.mock.calls[0] as unknown[])[1] as {
      client_order_code?: string;
    };
    expect(body.client_order_code).toBe('ORD-1-11');
  });
});
