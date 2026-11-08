import { CONG, HAN_MOI_CONG_MS } from '../../scripts/nghiem-thu';

/**
 * 07/11 và 08/11 cổng `npm test` hai lần bị cắt ở 10 phút, báo "tiến trình
 * chết giữa chừng" dù không bài nào đỏ: máy rảnh bộ test mất 434 giây, máy bận
 * (rustc, Roblox giữ CPU 100%) mất 955 giây. Hạn chung 10 phút để bắt treo,
 * không phải để đo tốc độ, nên cổng test cần hạn riêng.
 */
describe('nghiem-thu: hạn từng cổng', () => {
  it('cổng test có hạn riêng, dư cho lần đo 955 giây khi máy bận', () => {
    const test = CONG.find((c) => c.ten === 'test');
    expect(test?.hanMs).toBeGreaterThanOrEqual(1.5 * 955 * 1000);
  });

  it('các cổng khác vẫn giữ hạn chung để treo thì bị cắt', () => {
    for (const c of CONG.filter((c) => c.ten !== 'test')) {
      expect(c.hanMs ?? HAN_MOI_CONG_MS).toBe(HAN_MOI_CONG_MS);
    }
  });
});
