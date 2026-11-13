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
describe('rankByName: chữ chung "điện thoại"', () => {
  it('"điện thoại iPhone" vẫn ra iPhone dù tên món không có chữ điện thoại', () => {
    const items = [
      { name: 'iPhone 13 256GB' },
      { name: 'Ốp điện thoại Samsung' },
    ];
    expect(rankByName(items, 'điện thoại iPhone')).toEqual([
      { name: 'iPhone 13 256GB' },
    ]);
  });
});

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
      dropUnaskedFilters({ ...f, condition: 'good' }, ['iphone cũ còn tốt'])
        .condition,
    ).toBe('good');
  });

  it('giữ sắp xếp khi câu hỏi rẻ nhất hay mới nhất', () => {
    expect(
      dropUnaskedFilters({ ...f, sort: 'price_asc' }, ['nồi cơm rẻ nhất']).sort,
    ).toBe('price_asc');
    expect(dropUnaskedFilters(f, ['tai nghe mới đăng']).sort).toBe('newest');
  });

  it('đọc cả các câu trước trong cuộc trò chuyện', () => {
    expect(
      dropUnaskedFilters({ ...f, condition: 'like_new' }, [
        'tai nghe',
        'loại như mới thôi',
      ]).condition,
    ).toBe('like_new');
  });

  /**
   * Đo lại sau bản sửa đầu: "tai nghe bluetooth" ra price_max 999999999, "may
   * anh" ra price_max 3000000 và province "Hồ Chí Minh". Câu không có số tiền,
   * không có nơi chốn thì không được có giá, có tỉnh.
   */
  /**
   * Đo staging 13/11: "giày thể thao size 41" ra price_max 999999999 và
   * 2147483647; luật cũ "câu có chữ số là có nói giá" để lọt vì có số 41.
   */
  it('số không đi với tiền (size 41) không giữ được giá mô hình bịa', () => {
    const g = { q: 'giày thể thao size 41', price_max: 999999999 };
    expect(
      dropUnaskedFilters(g, ['giày thể thao size 41']).price_max,
    ).toBeUndefined();
  });

  it('giữ giá khi số đi với đơn vị tiền hoặc từ 1000 trở lên', () => {
    const g = { q: 'x', price_max: 10000000 };
    expect(dropUnaskedFilters(g, ['iphone 13 dưới 10 triệu']).price_max).toBe(
      10000000,
    );
    expect(dropUnaskedFilters(g, ['nồi 600k']).price_max).toBe(10000000);
    expect(dropUnaskedFilters(g, ['laptop dưới 3000000']).price_max).toBe(
      10000000,
    );
  });

  it('bỏ giá trần từ 1 tỷ trở lên khi người dùng không nói "tỷ"', () => {
    const g = { q: 'xe', price_max: 2147483647 };
    expect(dropUnaskedFilters(g, ['xe dưới 2 tỷ']).price_max).toBe(2147483647);
    expect(dropUnaskedFilters(g, ['xe đạp 900k']).price_max).toBeUndefined();
  });

  it('bỏ giá và tỉnh mô hình tự bịa', () => {
    const g = { q: 'máy ảnh', price_max: 3000000, province: 'Hồ Chí Minh' };
    expect(dropUnaskedFilters(g, ['may anh'])).toEqual({ q: 'máy ảnh' });
  });

  it('giữ giá khi câu có số tiền, giữ tỉnh khi câu có nơi chốn', () => {
    const g = { q: 'nồi', price_max: 600000, province: 'Hồ Chí Minh' };
    expect(dropUnaskedFilters(g, ['nồi dưới 600k ở HCM'])).toEqual(g);
    expect(
      dropUnaskedFilters(g, ['nồi', 'dưới 6 trăm nghìn thôi', 'sài gòn']),
    ).toEqual(g);
    expect(
      dropUnaskedFilters({ q: 'bàn', province: 'Hà Nội' }, ['bàn hà nội'])
        .province,
    ).toBe('Hà Nội');
  });

  /**
   * Sàn so tình trạng khớp CHÍNH XÁC: "iphone cũ" thành condition "used" (hạng
   * Cũ 70-80%) thì mất hết iPhone hạng Tốt, Như mới. Trên sàn đồ cũ, "cũ"
   * nghĩa là không mới, không phải một hạng.
   */
  it('không lọc theo hạng "used" vì chữ "cũ" nghĩa là đồ đã dùng nói chung', () => {
    expect(
      dropUnaskedFilters({ q: 'iphone', condition: 'used' }, ['iphone cũ'])
        .condition,
    ).toBeUndefined();
  });
});

/**
 * Bộ lọc do mô hình AI sinh ra là đầu vào KHÔNG tin được: nó có thể bịa
 * tham số, ghi giá dạng chuỗi "600k", đảo min và max, hay đưa từ khoá dài cả
 * đoạn. Mọi thứ phải qua `normalizeFilters` trước khi chạm tới truy vấn.
 */
/**
 * Đo staging 13/11: "quà tặng bạn gái" và "tai nghe chống ồn" ra rỗng cả 3 lần,
 * vì tên món không ghi "quà tặng" hay "chống ồn". Mô hình được gợi ý tối đa 3
 * tên món cụ thể; đây vẫn là đầu vào không tin được nên phải lọc.
 */
describe('normalizeFilters: alternatives', () => {
  it('giữ tối đa 3 tên gợi ý, bỏ trùng, bỏ rỗng, bỏ thứ không phải chữ, cắt dài', () => {
    const f = normalizeFilters({
      q: 'quà tặng bạn gái',
      alternatives: [
        ' đồng hồ ',
        'quà tặng bạn gái',
        '',
        42,
        'túi xách',
        'đồng hồ',
        'tai nghe',
        'balo',
        'x'.repeat(90),
      ],
    });
    expect(f.alternatives).toEqual(['đồng hồ', 'túi xách', 'tai nghe']);
  });

  it('không có hay sai kiểu thì không có trường alternatives', () => {
    expect(normalizeFilters({ q: 'nồi' }).alternatives).toBeUndefined();
    expect(
      normalizeFilters({ q: 'nồi', alternatives: 'đồng hồ' }).alternatives,
    ).toBeUndefined();
  });
});

/**
 * Đo staging 13/11: "laptop để học lập trình, tầm 5 triệu" ra price_min =
 * price_max = 5000000, chỉ còn món giá đúng 5 triệu. "Tầm" là khoảng, không
 * phải đúng bằng: hai đầu bằng nhau thì coi là giá trần.
 */
describe('normalizeFilters: giá hai đầu bằng nhau', () => {
  it('coi là giá trần, bỏ giá sàn', () => {
    const f = normalizeFilters({
      q: 'laptop',
      price_min: 5000000,
      price_max: 5000000,
    });
    expect(f.price_max).toBe(5000000);
    expect(f.price_min).toBeUndefined();
  });
});

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
