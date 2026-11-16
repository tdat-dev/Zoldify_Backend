import { of } from 'rxjs';
import { GhnService } from './ghn.service';

/**
 * H-08 (16/11): checkout chặn mọi đơn vì GHN trả
 *
 *   GHN 400: Lỗi gọi API: corev2_tenant_order_calculate_fee - calculate fee
 *   error: calculate service fee error: route not found service.
 *
 * Tuyến có thật (available-services trả về bình thường), nên lỗi nằm ở BODY của
 * /shipping-order/fee: code cũ gửi `service_id` — trường mà tài liệu GHN ghi
 * "for reference only; not used when calling Calculate Fee" — thay vì
 * `service_type_id`, và không gửi `from_ward_code` của người bán.
 *
 * Bài kiểm này khoá đúng hình dạng body đó, vì lỗi chỉ lộ ra khi gọi GHN thật.
 */
function makeGhn(services: unknown[]) {
  const http = {
    post: jest.fn((url: string) => {
      if (url.endsWith('/available-services')) {
        return of({ data: { code: 200, data: services } });
      }
      return of({ data: { code: 200, data: { total: 22000 } } });
    }),
  };
  return { svc: new GhnService(http as never), http };
}

function feeBody(http: { post: jest.Mock }) {
  const call = http.post.mock.calls.find(([url]: [string]) =>
    String(url).endsWith('/shipping-order/fee'),
  );
  return call?.[1] as Record<string, unknown>;
}

const dichVuNhe = { service_id: 53320, service_type_id: 2, short_name: 'Hàng nhẹ' };
const dichVuNang = { service_id: 53321, service_type_id: 5, short_name: 'Hàng nặng' };

describe('GHN: body của /shipping-order/fee', () => {
  it('gửi service_type_id, KHÔNG gửi service_id', async () => {
    const { svc, http } = makeGhn([dichVuNhe]);
    await svc.calculateFee({
      to_district_id: 1442,
      to_ward_code: '21012',
      weight: 200,
      from_district_id: 1680,
      from_ward_code: '220101',
    });

    const body = feeBody(http);
    expect(body.service_type_id).toBe(2);
    expect(body).not.toHaveProperty('service_id');
    expect(body.from_district_id).toBe(1680);
    expect(body.from_ward_code).toBe('220101');
    expect(body.to_ward_code).toBe('21012');
  });

  it('kiện từ 20 kg chọn gói nặng (service_type_id 5)', async () => {
    const { svc, http } = makeGhn([dichVuNhe, dichVuNang]);
    await svc.calculateFee({
      to_district_id: 1442,
      to_ward_code: '21012',
      weight: 25000,
    });

    expect(feeBody(http).service_type_id).toBe(5);
  });

  it('shop chưa khai phường lấy hàng thì bỏ from_ward_code để GHN dùng mặc định', async () => {
    const { svc, http } = makeGhn([dichVuNhe]);
    await svc.calculateFee({
      to_district_id: 1442,
      to_ward_code: '21012',
      weight: 200,
    });

    expect(feeBody(http)).not.toHaveProperty('from_ward_code');
  });
});
