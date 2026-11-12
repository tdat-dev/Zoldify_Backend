import {
  cauTraLoi,
  chuanHoaBoLoc,
  docTraLoiMoHinh,
  TINH_TRANG_HOP_LE,
} from './bo-loc-tro-ly';

/**
 * Bộ lọc do mô hình AI sinh ra là đầu vào KHÔNG tin được: nó có thể bịa
 * tham số, ghi giá dạng chuỗi "600k", đảo min và max, hay đưa từ khoá dài cả
 * đoạn. Mọi thứ phải qua `chuanHoaBoLoc` trước khi chạm tới truy vấn.
 */
describe('chuanHoaBoLoc', () => {
  it('giữ đúng các trường hợp lệ', () => {
    expect(
      chuanHoaBoLoc({
        q: 'nồi cơm điện Nhật',
        price_max: 600000,
        province: 'Hồ Chí Minh',
        condition: 'good',
        sort: 'price_asc',
      }),
    ).toEqual({
      q: 'nồi cơm điện Nhật',
      price_max: 600000,
      province: 'Hồ Chí Minh',
      condition: 'good',
      sort: 'price_asc',
    });
  });

  it('đọc giá dạng chuỗi 600k, 1tr, 1,5 triệu', () => {
    expect(chuanHoaBoLoc({ q: 'a', price_max: '600k' }).price_max).toBe(600000);
    expect(chuanHoaBoLoc({ q: 'a', price_max: '1tr' }).price_max).toBe(1000000);
    expect(chuanHoaBoLoc({ q: 'a', price_max: '1,5 triệu' }).price_max).toBe(1500000);
  });

  it('bỏ giá âm, bằng 0 hoặc không đọc được', () => {
    const b = chuanHoaBoLoc({ q: 'a', price_min: -5, price_max: 'rẻ' });
    expect(b.price_min).toBeUndefined();
    expect(b.price_max).toBeUndefined();
  });

  it('đổi chỗ khi min lớn hơn max', () => {
    const b = chuanHoaBoLoc({ q: 'a', price_min: 900000, price_max: 100000 });
    expect(b).toMatchObject({ price_min: 100000, price_max: 900000 });
  });

  it('bỏ tình trạng và kiểu sắp xếp lạ', () => {
    const b = chuanHoaBoLoc({ q: 'a', condition: 'broken', sort: 'DROP TABLE' });
    expect(b.condition).toBeUndefined();
    expect(b.sort).toBeUndefined();
    expect(TINH_TRANG_HOP_LE).toContain('like_new');
  });

  it('cắt từ khoá quá dài và bỏ khoảng trắng thừa', () => {
    const b = chuanHoaBoLoc({ q: `  ${'a'.repeat(200)}  ` });
    expect(b.q.length).toBeLessThanOrEqual(80);
  });

  it('không nhận trường lạ (mô hình tự bịa seller_id)', () => {
    const b = chuanHoaBoLoc({ q: 'a', seller_id: 7, category_id: 3 } as never);
    expect(b).toEqual({ q: 'a' });
  });
});

/**
 * Router 9router trả JSON rồi nối thêm dòng `data: [DONE]` (dấu vết của chế độ
 * stream) vào cùng một body. JSON.parse thẳng body đó sẽ ném lỗi.
 */
describe('docTraLoiMoHinh', () => {
  const body = (message: object) =>
    JSON.stringify({ choices: [{ message }] }) + 'data: [DONE]\n\n';

  it('lấy bộ lọc từ tool call search_products', () => {
    const kq = docTraLoiMoHinh(
      body({
        content: null,
        tool_calls: [
          {
            type: 'function',
            function: {
              name: 'search_products',
              arguments: '{"q": "nồi cơm", "price_max": 600000}',
            },
          },
        ],
      }),
    );
    expect(kq.boLoc).toEqual({ q: 'nồi cơm', price_max: 600000 });
  });

  it('không có tool call thì lấy câu trả lời chữ', () => {
    const kq = docTraLoiMoHinh(body({ content: 'Bạn muốn tìm món gì?' }));
    expect(kq.boLoc).toBeUndefined();
    expect(kq.loiDap).toBe('Bạn muốn tìm món gì?');
  });

  it('body hỏng thì trả rỗng, không ném lỗi', () => {
    expect(docTraLoiMoHinh('<html>502</html>')).toEqual({});
  });
});

describe('cauTraLoi', () => {
  it('kể lại bộ lọc đã hiểu, giá theo kiểu Việt', () => {
    const s = cauTraLoi({ q: 'nồi cơm', price_max: 600000, province: 'Hồ Chí Minh' }, 3, []);
    expect(s).toContain('3 món');
    expect(s).toContain('nồi cơm');
    expect(s).toContain('600.000');
    expect(s).toContain('Hồ Chí Minh');
  });

  it('nói rõ đã nới bộ lọc nào khi không có kết quả', () => {
    const s = cauTraLoi({ q: 'nồi cơm' }, 2, ['tỉnh Hà Giang']);
    expect(s).toContain('Hà Giang');
  });

  it('không có món nào thì gợi ý cách hỏi khác', () => {
    expect(cauTraLoi({ q: 'xyz' }, 0, [])).toMatch(/chưa tìm thấy/i);
  });
});
