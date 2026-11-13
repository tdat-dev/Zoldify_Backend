import { parseFallback } from './assistant-fallback';

/**
 * Đường lui khi mô hình lỗi: tự tách giá, tỉnh, bỏ chữ thừa, không cần mạng.
 * Đo staging 13/11 (150 lượt): router trả 503 năm lần, quá hạn ba lần; hai lượt
 * trượt vì tìm bằng nguyên câu gõ: "loại dưới 200k thôi" thành từ khoá "200k
 * thôi", "tim giay the thao size 41" giữ chữ "tim".
 */
const user = (content: string) => ({ role: 'user' as const, content });
const bot = (content: string) => ({ role: 'assistant' as const, content });

describe('parseFallback', () => {
  it('tách giá trần, tỉnh, bỏ chữ thừa', () => {
    expect(parseFallback([user('nồi cơm điện dưới 600k ở HCM')])).toEqual({
      q: 'nồi cơm điện',
      price_max: 600000,
      province: 'Hồ Chí Minh',
    });
  });

  it('khoảng giá "từ X đến Y"', () => {
    expect(
      parseFallback([user('điện thoại samsung từ 1 đến 3 triệu')]),
    ).toEqual({
      q: 'điện thoại samsung',
      price_min: 1000000,
      price_max: 3000000,
    });
  });

  it('"tầm X" là giá trần', () => {
    expect(parseFallback([user('laptop tầm 5tr')])).toEqual({
      q: 'laptop',
      price_max: 5000000,
    });
  });

  it('bỏ cả chữ thừa gõ không dấu', () => {
    expect(parseFallback([user('tim giay the thao size 41')]).q).toBe(
      'giay the thao size 41',
    );
    expect(parseFallback([user('dong ho casio duoi 2 trieu')])).toEqual({
      q: 'dong ho casio',
      price_max: 2000000,
    });
  });

  it('câu nối tiếp không có tên món thì lấy tên món từ câu trước', () => {
    expect(
      parseFallback([
        user('tai nghe bluetooth'),
        bot('Mình tìm được 6 món.'),
        user('loại dưới 200k thôi'),
      ]),
    ).toEqual({ q: 'tai nghe bluetooth', price_max: 200000 });
  });

  /**
   * Đo staging 13/11: router 503 đúng lượt "cheap bluetooth headphones", đường
   * lui tìm nguyên câu tiếng Anh, tên món toàn tiếng Việt nên ra rỗng.
   */
  it('hiểu vài chữ tiếng Anh thông dụng', () => {
    expect(parseFallback([user('cheap bluetooth headphones')])).toEqual({
      q: 'bluetooth tai nghe',
      sort: 'price_asc',
    });
    expect(parseFallback([user('used phone under 3tr')])).toEqual({
      q: 'điện thoại',
      price_max: 3000000,
    });
  });

  it('Hà Nội', () => {
    expect(parseFallback([user('laptop ở Hà Nội')])).toEqual({
      q: 'laptop',
      province: 'Hà Nội',
    });
  });
});
