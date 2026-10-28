import { MAX_PAGINATION_DEPTH, catDoSau } from './pagination.dto';

/**
 * Ranh giới của trần độ sâu (xem `catDoSau`). Bài DB
 * `trang-qua-sau.spec.ts` đo câu SQL thật; bài này đo phép tính ở mép trần,
 * nơi dễ lệch một dòng nhất.
 */
describe('catDoSau', () => {
  it('trần mặc định là 10.000 dòng', () => {
    expect(MAX_PAGINATION_DEPTH).toBe(10_000);
  });

  it('trang nông lấy đủ cỡ trang', () => {
    expect(catDoSau({ offset: 0, size: 20 })).toEqual({
      ngoaiTran: false,
      take: 20,
    });
  });

  it('trang cuối nằm vừa khít trần vẫn lấy đủ', () => {
    // cỡ 100, trang 100: dòng 9.901 tới 10.000.
    expect(catDoSau({ offset: 9_900, size: 100 })).toEqual({
      ngoaiTran: false,
      take: 100,
    });
  });

  it('trang vắt qua trần bị cắt còn đúng phần trong trần', () => {
    // cỡ 30, trang 334: dòng 9.991 tới 10.020, chỉ 10 dòng trong trần.
    expect(catDoSau({ offset: 9_990, size: 30 })).toEqual({
      ngoaiTran: false,
      take: 10,
    });
  });

  it('trang bắt đầu đúng ở trần hoặc sâu hơn: không lấy dòng nào', () => {
    expect(catDoSau({ offset: 10_000, size: 10 })).toEqual({
      ngoaiTran: true,
      take: 0,
    });
    expect(catDoSau({ offset: 899_900, size: 100 }).ngoaiTran).toBe(true);
  });

  it('trần tuỳ chỉnh', () => {
    expect(catDoSau({ offset: 40, size: 20 }, 50)).toEqual({
      ngoaiTran: false,
      take: 10,
    });
  });
});
