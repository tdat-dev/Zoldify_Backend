import {
  buildReply,
  normalizeFilters,
  parseModelResponse,
  dropUnaskedFilters,
  rankByName,
  VALID_CONDITIONS,
} from './assistant-filters';

/**
 * Đo trên staging 12/11 với gpt-6-luna: hỏi "tai nghe bluetooth" thì mô hình tự
 * thêm condition "new" và sort "newest". Sàn đồ cũ gần như không có hàng mới,
 * nên mọi câu ra rỗng. Hai bộ lọc này chỉ giữ khi người dùng có nhắc tới.
 */
describe('dropUnaskedFilters', () => {
  const f = {
    q: 'tai nghe bluetooth',
    condition: 'new' as const,
    sort: 'newest' as const,
  };

  it('bỏ tình trạng và sắp xếp người dùng không nhắc tới', () => {
    expect(dropUnaskedFilters(f, ['tai nghe bluetooth'])).toEqual({
      q: 'tai nghe bluetooth',
    });
  });

  it('giữ tình trạng khi câu có chữ chỉ tình trạng', () => {
    expect(
      dropUnaskedFilters({ ...f, condition: 'like_new' }, [
        'giày chạy bộ như mới',
      ]).condition,
    ).toBe('like_new');
    expect(
      dropUnaskedFilters({ ...f, condition: 'used' }, ['iphone cũ']).condition,
    ).toBe('used');
  });

  it('giữ sắp xếp khi câu hỏi rẻ nhất hay mới nhất', () => {
    expect(
      dropUnaskedFilters({ ...f, sort: 'price_asc' }, ['nồi cơm rẻ nhất']).sort,
    ).toBe('price_asc');
    expect(dropUnaskedFilters(f, ['tai nghe mới đăng']).sort).toBe('newest');
  });

  it('đọc cả các câu trước trong cuộc trò chuyện', () => {
    expect(
      dropUnaskedFilters({ ...f, condition: 'used' }, [
        'tai nghe',
        'loại cũ thôi',
      ]).condition,
    ).toBe('used');
  });

  it('không đụng giá và tỉnh', () => {
    const g = { q: 'nồi', price_max: 600000, province: 'Hồ Chí Minh' };
    expect(dropUnaskedFilters(g, ['nồi'])).toEqual(g);
  });
});

/**
 * Bộ lọc do mô hình AI sinh ra là đầu vào KHÔNG tin được: nó có thể bịa
 * tham số, ghi giá dạng chuỗi "600k", đảo min và max, hay đưa từ khoá dài cả
 * đoạn. Mọi thứ phải qua `normalizeFilters` trước khi chạm tới truy vấn.
 */
describe('normalizeFilters', () => {
  it('giữ đúng các trường hợp lệ', () => {
    expect(
      normalizeFilters({
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
    expect(normalizeFilters({ q: 'a', price_max: '600k' }).price_max).toBe(
      600000,
    );
    expect(normalizeFilters({ q: 'a', price_max: '1tr' }).price_max).toBe(
      1000000,
    );
    expect(normalizeFilters({ q: 'a', price_max: '1,5 triệu' }).price_max).toBe(
      1500000,
    );
  });

  it('bỏ giá âm, bằng 0 hoặc không đọc được', () => {
    const b = normalizeFilters({ q: 'a', price_min: -5, price_max: 'rẻ' });
    expect(b.price_min).toBeUndefined();
    expect(b.price_max).toBeUndefined();
  });

  it('đổi chỗ khi min lớn hơn max', () => {
    const b = normalizeFilters({
      q: 'a',
      price_min: 900000,
      price_max: 100000,
    });
    expect(b).toMatchObject({ price_min: 100000, price_max: 900000 });
  });

  it('bỏ tình trạng và kiểu sắp xếp lạ', () => {
    const b = normalizeFilters({
      q: 'a',
      condition: 'broken',
      sort: 'DROP TABLE',
    });
    expect(b.condition).toBeUndefined();
    expect(b.sort).toBeUndefined();
    expect(VALID_CONDITIONS).toContain('like_new');
  });

  it('cắt từ khoá quá dài và bỏ khoảng trắng thừa', () => {
    const b = normalizeFilters({ q: `  ${'a'.repeat(200)}  ` });
    expect(b.q.length).toBeLessThanOrEqual(80);
  });

  it('không nhận trường lạ (mô hình tự bịa seller_id)', () => {
    const b = normalizeFilters({ q: 'a', seller_id: 7, category_id: 3 });
    expect(b).toEqual({ q: 'a' });
  });
});

/**
 * Router 9router trả JSON rồi nối thêm dòng `data: [DONE]` (dấu vết của chế độ
 * stream) vào cùng một body. JSON.parse thẳng body đó sẽ ném lỗi.
 */
describe('parseModelResponse', () => {
  const body = (message: object) =>
    JSON.stringify({ choices: [{ message }] }) + 'data: [DONE]\n\n';

  it('lấy bộ lọc từ tool call search_products', () => {
    const kq = parseModelResponse(
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
    expect(kq.filters).toEqual({ q: 'nồi cơm', price_max: 600000 });
  });

  it('không có tool call thì lấy câu trả lời chữ', () => {
    const kq = parseModelResponse(body({ content: 'Bạn muốn tìm món gì?' }));
    expect(kq.filters).toBeUndefined();
    expect(kq.text).toBe('Bạn muốn tìm món gì?');
  });

  it('body hỏng thì trả rỗng, không ném lỗi', () => {
    expect(parseModelResponse('<html>502</html>')).toEqual({});
  });
});

/**
 * Tìm FULLTEXT trả món chỉ cần trùng MỘT chữ: hỏi "nồi cơm điện" thì nồi áp
 * suất và máy xay (trùng "nồi", "điện") đứng trước nồi cơm thật (đo trên
 * staging 12/11). Trợ lý xếp lại theo số chữ của câu hỏi có trong tên món.
 */
describe('rankByName', () => {
  const p = (id: number, name: string) => ({ id, name });

  it('có món khớp đủ thì bỏ món chỉ trùng một chữ', () => {
    const ranked = rankByName(
      [
        p(1, 'Nồi áp suất 4L cũ'),
        p(2, 'Máy xay sinh tố điện'),
        p(3, 'Nồi cơm điện 1.5L dùng kỹ'),
      ],
      'nồi cơm điện',
    );
    expect(ranked.map((x) => x.id)).toEqual([3]);
  });

  it('mô hình thêm chữ xuất xứ ("Nhật") vẫn giữ đúng nồi cơm', () => {
    const ranked = rankByName(
      [p(1, 'Nồi áp suất 4L'), p(2, 'Nồi cơm điện 1.5L'), p(3, 'Ấm siêu tốc')],
      'nồi cơm điện Nhật',
    );
    expect(ranked.map((x) => x.id)).toEqual([2]);
  });

  it('không tính chữ chung chung như "cũ", "mới", "như"', () => {
    const ranked = rankByName(
      [p(1, 'Áo khoác như mới'), p(2, 'Giày chạy bộ Nike')],
      'giày chạy bộ như mới',
    );
    expect(ranked.map((x) => x.id)).toEqual([2]);
  });

  it('không món nào khớp đủ thì trả rỗng, không đưa món sai', () => {
    const ranked = rankByName(
      [p(1, 'Bàn gỗ'), p(2, 'Ghế sofa da')],
      'sofa giường gấp thông minh',
    );
    expect(ranked).toEqual([]);
  });

  /**
   * Tìm kiếm của sàn không phân biệt dấu (collation unicode_ci): "bàn" ra cả
   * "bán", "bánh" (staging 12/11: hỏi bàn ra máy nướng bánh mì).
   */
  it('phân biệt dấu: bàn không khớp bán, bánh', () => {
    const ranked = rankByName(
      [p(1, 'Máy nướng bánh mì'), p(2, 'Đồ cũ bán gấp'), p(3, 'Bàn gỗ thông')],
      'bàn gỗ',
    );
    expect(ranked.map((x) => x.id)).toEqual([3]);
  });

  it('gõ không dấu vẫn khớp tên có dấu', () => {
    const ranked = rankByName(
      [p(1, 'Máy Ảnh Canon EOS'), p(2, 'Máy xay')],
      'may anh canon',
    );
    expect(ranked.map((x) => x.id)).toEqual([1]);
  });

  it('câu hai chữ phải khớp cả hai: máy ảnh không ra máy xay', () => {
    const ranked = rankByName(
      [p(1, 'Máy xay sinh tố'), p(2, 'Máy ảnh Sony A6000')],
      'máy ảnh',
    );
    expect(ranked.map((x) => x.id)).toEqual([2]);
  });

  it('giữ nguyên thứ tự gốc khi điểm bằng nhau', () => {
    const ranked = rankByName(
      [p(1, 'Giày A'), p(2, 'Giày B'), p(3, 'Giày C')],
      'giày',
    );
    expect(ranked.map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe('buildReply', () => {
  it('kể lại bộ lọc đã hiểu, giá theo kiểu Việt', () => {
    const s = buildReply(
      { q: 'nồi cơm', price_max: 600000, province: 'Hồ Chí Minh' },
      3,
      [],
    );
    expect(s).toContain('3 món');
    expect(s).toContain('nồi cơm');
    expect(s).toContain('600.000');
    expect(s).toContain('Hồ Chí Minh');
  });

  it('nói rõ đã nới bộ lọc nào khi không có kết quả', () => {
    const s = buildReply({ q: 'nồi cơm' }, 2, ['tỉnh Hà Giang']);
    expect(s).toContain('Hà Giang');
  });

  it('không có món nào thì gợi ý cách hỏi khác', () => {
    expect(buildReply({ q: 'xyz' }, 0, [])).toMatch(/chưa tìm thấy/i);
  });
});
