import { of, throwError } from 'rxjs';
import { GhnService } from './ghn.service';

/**
 * Ô chọn quận còn "Quận Đặc Biệt" (D-08, E2E mobile 02/11; đã thấy từ E2E
 * 30/09: "Quận Đặc Biệt" không có phường nào).
 *
 * Đó là dữ liệu của GHN, không phải của mình: app đọc thẳng /ghn/districts,
 * backend chỉ chuyển tiếp danh mục GHN kèm bộ lọc Status/SupportType. Quận này
 * qua được bộ lọc đó, nên không lọc theo cờ được.
 *
 * Luật lọc chọn ở đây không dựa vào tên: quận KHÔNG CÒN PHƯỜNG NÀO đang phục
 * vụ thì không ai điền xong địa chỉ được (ô phường trống), nên bỏ nó là đúng
 * với mọi quận, kể cả quận thật mà GHN tạm ngừng hết phường. Cùng cách đã làm
 * cho tỉnh (tỉnh không còn quận nào thì bỏ, commit 1c1f85b).
 */
type Body = { province_id?: number; district_id?: number };

function ghn(
  districtsOf: Record<number, unknown[]>,
  wardsOf: Record<number, unknown[] | Error>,
  provinces: unknown[] = [],
) {
  const http = {
    get: jest.fn(() => of({ data: { data: provinces } })),
    post: jest.fn((url: string, body: Body) => {
      if (url.endsWith('/district')) {
        return of({
          data: { data: districtsOf[body.province_id ?? -1] ?? [] },
        });
      }
      const w = wardsOf[body.district_id ?? -1] ?? [];
      return w instanceof Error
        ? throwError(() => w)
        : of({ data: { data: w } });
    }),
  };
  return { svc: new GhnService(http as never), http };
}

const quan = (DistrictID: number, DistrictName: string) => ({
  DistrictID,
  DistrictName,
  Status: 1,
  SupportType: 3,
});
const phuong = (WardCode: string) => ({ WardCode, Status: 1, SupportType: 3 });

describe('GHN: bỏ quận không còn phường nào (D-08)', () => {
  it('"Quận Đặc Biệt" không có phường thì không hiện', async () => {
    const { svc } = ghn(
      { 268: [quan(3440, 'Quận Đặc Biệt'), quan(1680, 'Thành phố Hưng Yên')] },
      { 3440: [], 1680: [phuong('220101')] },
    );
    const ds = (await svc.getDistricts(268)) as Array<{ DistrictID: number }>;
    expect(ds.map((d) => d.DistrictID)).toEqual([1680]);
  });

  it('quận chỉ còn phường ngừng phục vụ cũng bỏ', async () => {
    const { svc } = ghn(
      { 268: [quan(3440, 'Quận Đặc Biệt'), quan(1680, 'Thành phố Hưng Yên')] },
      {
        3440: [{ WardCode: '1', Status: 2, SupportType: 0 }],
        1680: [phuong('220101')],
      },
    );
    const ds = (await svc.getDistricts(268)) as Array<{ DistrictID: number }>;
    expect(ds.map((d) => d.DistrictID)).toEqual([1680]);
  });

  it('tải phường lỗi thì GIỮ quận: GHN chập chờn không làm mất quận thật', async () => {
    const { svc } = ghn(
      { 268: [quan(1680, 'Thành phố Hưng Yên')] },
      { 1680: new Error('GHN timeout') },
    );
    const ds = (await svc.getDistricts(268)) as Array<{ DistrictID: number }>;
    expect(ds.map((d) => d.DistrictID)).toEqual([1680]);
  });

  it('mở danh sách tỉnh KHÔNG gọi tải phường (63 tỉnh x ~11 quận là ~700 lời gọi)', async () => {
    const { svc, http } = ghn(
      { 268: [quan(1680, 'Thành phố Hưng Yên')] },
      { 1680: [phuong('220101')] },
      [{ ProvinceID: 268, ProvinceName: 'Hưng Yên', IsEnable: 1 }],
    );
    const ps = (await svc.getProvinces()) as Array<{ ProvinceID: number }>;
    expect(ps.map((p) => p.ProvinceID)).toEqual([268]);
    const goiPhuong = http.post.mock.calls.filter(([url]) =>
      String(url).endsWith('/ward'),
    );
    expect(goiPhuong).toHaveLength(0);
  });
});
