import { OrdersService } from './orders.service';
import { OrderStatus } from './entities/order.entity';
import { ShipmentStatus } from './entities/order-shipment.entity';

/**
 * B-19 (audit B-production-readiness.md): tạo vận đơn GHN tuần tự theo từng
 * người bán, timeout 30s, không retry. GHN chậm thì request xác nhận treo
 * 30s NHÂN số người bán trong đơn.
 *
 * Hai điều bài kiểm này đo:
 *  1. `createGhnShipmentsPerSeller` gọi GHN SONG SONG cho các người bán khác
 *     nhau — không chờ seller A xong mới gọi cho seller B.
 *  2. Lỗi KHÔNG CÓ response (timeout/mạng) được thử lại; lỗi CÓ response
 *     (GHN từ chối thật, vd 400) thì ném ngay, không thử lại.
 *
 * Đo bằng THỨ TỰ gọi (ai được gọi trước khi ai resolve), không đo bằng mốc
 * thời gian tường — đo thời gian dễ flaky và không chứng minh được gì về
 * code, chỉ chứng minh máy CI hôm đó nhanh hay chậm.
 */

const khoPhat = { phat: () => Promise.resolve() } as never;

const SELLER_A = { id: 11, full_name: 'Người bán A' };
const SELLER_B = { id: 12, full_name: 'Người bán B' };

function repo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    create: jest.fn((x: unknown) => x),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

function makeService(ghn: { createOrder: jest.Mock }) {
  const orderRepo = repo();
  const shipmentRepo = repo();
  const shopRepo = repo();
  shopRepo.find.mockResolvedValue([]); // không ai khai pickup -> from = undefined, không ảnh hưởng bài kiểm này

  const svc = new OrdersService(
    orderRepo as never,
    repo() as never,
    shipmentRepo as never,
    shopRepo as never,
    repo() as never,
    repo() as never,
    repo() as never,
    { create: jest.fn() } as never,
    ghn as never,
    {} as never,
    {} as never,
    {} as never,
    { transaction: jest.fn() } as never,
    khoPhat,
  );
  return { svc, orderRepo, shipmentRepo };
}

/** `retryGhnShipments` chỉ cho người bán (của bất kỳ món nào trong đơn) hoặc admin gọi. */
function nguoiGoiLaSellerA() {
  return { id: SELLER_A.id, role: 'seller' };
}

function donHaiNguoiBan() {
  return {
    id: 7,
    order_code: 'ORD-20261008-700',
    status: OrderStatus.CONFIRMED,
    payment_method: 'cod',
    receiver_name: 'Người mua',
    receiver_phone: '0901234567',
    shipping_address: '12 Đường Test',
    ghn_district_id: 1680,
    ghn_ward_code: '220117',
    items: [
      {
        product_name: 'Hàng của A',
        price: '100000.00',
        subtotal: '100000.00',
        quantity: 1,
        product: { id: 1, seller: SELLER_A },
      },
      {
        product_name: 'Hàng của B',
        price: '200000.00',
        subtotal: '200000.00',
        quantity: 1,
        product: { id: 2, seller: SELLER_B },
      },
    ],
  };
}

describe('B-19: tạo vận đơn GHN theo từng người bán phải chạy SONG SONG', () => {
  it('gọi GHN cho seller B TRƯỚC khi seller A (đang treo) resolve', async () => {
    let goiAChuaResolve = true;
    let bDaDuocGoiTrongLucAConTreo = false;

    const createOrder = jest
      .fn()
      .mockImplementation((dto: { client_order_code?: string }) => {
        if (dto.client_order_code?.endsWith(`-${SELLER_A.id}`)) {
          // Seller A: trả một promise KHÔNG BAO GIỜ tự resolve trong bài kiểm —
          // mô phỏng một cuộc gọi GHN đang treo (chậm/timeout).
          return new Promise((resolve) => {
            (createOrder as unknown as { _resolveA: () => void })._resolveA =
              () => {
                goiAChuaResolve = false;
                resolve({ order_code: 'A-CODE' });
              };
          });
        }
        if (dto.client_order_code?.endsWith(`-${SELLER_B.id}`)) {
          // Nếu tới đây mà seller A còn đang treo, nghĩa là B được gọi SONG
          // SONG với A — đúng cái cần chứng minh. Vòng lặp tuần tự cũ sẽ
          // KHÔNG BAO GIỜ gọi tới B vì await A không bao giờ xong.
          bDaDuocGoiTrongLucAConTreo = goiAChuaResolve;
          return Promise.resolve({ order_code: 'B-CODE' });
        }
        throw new Error(
          'client_order_code không khớp seller nào trong bài kiểm',
        );
      });

    const { svc, orderRepo } = makeService({ createOrder });
    orderRepo.findOne.mockResolvedValue(donHaiNguoiBan());

    const chay = svc.retryGhnShipments(7, nguoiGoiLaSellerA() as never);
    // Nhường hẳn một vòng macrotask: đủ cho MỌI promise microtask còn đang
    // chờ (findOne, shipmentRepo.find, shopRepo.find, rồi tới createOrder của
    // cả hai seller) chạy xong, kể cả khi chuỗi await lồng nhiều cấp.
    await new Promise((r) => setTimeout(r, 0));

    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(bDaDuocGoiTrongLucAConTreo).toBe(true);

    // Dọn: để seller A resolve cho xong, tránh unhandled/treo test runner.
    (createOrder as unknown as { _resolveA?: () => void })._resolveA?.();
    await chay;
  });
});

describe('B-19: lỗi mạng (không có response) được thử lại; lỗi GHN từ chối thật thì không', () => {
  it('timeout ở lần gọi đầu, lần thử lại thành công → vận đơn CREATED', async () => {
    const loiTimeout = Object.assign(new Error('timeout of 10000ms exceeded'), {
      code: 'ECONNABORTED',
      // CHỦ Ý không có .response — đây là dấu hiệu phân biệt lỗi mạng với
      // lỗi GHN từ chối thật (GHN từ chối luôn có response.status).
    });
    const createOrder = jest
      .fn()
      .mockRejectedValueOnce(loiTimeout)
      .mockResolvedValueOnce({ order_code: 'OK-SAU-RETRY' });

    const { svc, orderRepo, shipmentRepo } = makeService({ createOrder });
    // Chỉ một người bán cho bài kiểm này — đơn giản hoá việc đọc kết quả save.
    const donMotNguoiBan = {
      ...donHaiNguoiBan(),
      items: [donHaiNguoiBan().items[0]],
    };
    orderRepo.findOne.mockResolvedValue(donMotNguoiBan);

    await svc.retryGhnShipments(7, nguoiGoiLaSellerA() as never);

    expect(createOrder).toHaveBeenCalledTimes(2); // 1 lần hỏng + 1 lần thử lại
    const saved = shipmentRepo.save.mock.calls.map(
      (c) => c[0] as { status: string },
    );
    expect(saved).toContainEqual(
      expect.objectContaining({
        status: ShipmentStatus.CREATED,
        tracking_code: 'OK-SAU-RETRY',
      }),
    );
  });

  it('GHN từ chối thật (400, có response) → ném ngay, KHÔNG thử lại', async () => {
    const loiGhnTuChoi = Object.assign(
      new Error('Request failed with status code 400'),
      {
        isAxiosError: true,
        response: {
          status: 400,
          data: { message: 'Không tìm thấy thông tin quận' },
        },
      },
    );
    const createOrder = jest.fn().mockRejectedValue(loiGhnTuChoi);

    const { svc, orderRepo, shipmentRepo } = makeService({ createOrder });
    const donMotNguoiBan = {
      ...donHaiNguoiBan(),
      items: [donHaiNguoiBan().items[0]],
    };
    orderRepo.findOne.mockResolvedValue(donMotNguoiBan);

    await svc.retryGhnShipments(7, nguoiGoiLaSellerA() as never);

    expect(createOrder).toHaveBeenCalledTimes(1); // không thử lại lỗi từ chối thật
    const saved = shipmentRepo.save.mock.calls.map(
      (c) => c[0] as { status: string; error?: string },
    );
    expect(saved).toContainEqual(
      expect.objectContaining({ status: ShipmentStatus.FAILED }),
    );
  });
});
