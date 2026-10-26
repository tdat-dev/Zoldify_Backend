import { BoDemNhip, RedisDem } from './bo-dem-nhip';

/**
 * Bộ đếm nhịp dùng chung Redis: hai bản api (hai đối tượng BoDemNhip) cùng
 * trỏ vào một Redis thì chia chung một hạn mức cho mỗi người. Redis giả ở đây
 * chỉ cài đúng hai lệnh bộ đếm dùng (SET ... PX NX và INCR), đủ để kiểm cách
 * gọi; Redis thật không có trên máy chạy test.
 */
function redisGia(): RedisDem & { kho: Map<string, number> } {
  const kho = new Map<string, number>();
  return {
    kho,
    set: (k: string, v: number) => {
      if (!kho.has(k)) kho.set(k, v);
      return Promise.resolve('OK');
    },
    incr: (k: string) => {
      const n = (kho.get(k) ?? 0) + 1;
      kho.set(k, n);
      return Promise.resolve(n);
    },
  };
}

describe('BoDemNhip', () => {
  it('hai bản api dùng chung Redis chia chung hạn mức của một người', async () => {
    const redis = redisGia();
    const banA = new BoDemNhip('chat_nhip', 10, 10_000, redis);
    const banB = new BoDemNhip('chat_nhip', 10, 10_000, redis);

    let duoc = 0;
    for (let i = 0; i < 8; i++) if (await banA.conTrongHan(2)) duoc++;
    for (let i = 0; i < 8; i++) if (await banB.conTrongHan(2)) duoc++;

    expect(duoc).toBe(10);
  });

  it('người khác có hạn mức riêng', async () => {
    const dem = new BoDemNhip('chat_nhip', 1, 10_000, redisGia());
    expect(await dem.conTrongHan(2)).toBe(true);
    expect(await dem.conTrongHan(2)).toBe(false);
    expect(await dem.conTrongHan(3)).toBe(true);
  });

  it('Redis lỗi thì rơi về đếm trong RAM, vẫn chặn chứ không mở toang', async () => {
    const hong: RedisDem = {
      set: () => Promise.reject(new Error('Stream not writeable')),
      incr: () => Promise.reject(new Error('Stream not writeable')),
    };
    const dem = new BoDemNhip('chat_nhip', 3, 10_000, hong);

    let duoc = 0;
    for (let i = 0; i < 5; i++) if (await dem.conTrongHan(2)) duoc++;

    expect(duoc).toBe(3);
  });

  it('không có Redis (máy dev) thì đếm trong RAM theo người dùng', async () => {
    const dem = new BoDemNhip('chat_nhip', 2, 10_000, null);
    expect(await dem.conTrongHan(2)).toBe(true);
    expect(await dem.conTrongHan(2)).toBe(true);
    expect(await dem.conTrongHan(2)).toBe(false);
  });
});
