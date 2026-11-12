import { baseReview, marketPrice, parseReviewNotes } from './assistant-review';

/**
 * Đánh giá từng món: phần con số (giá so với mặt bằng) tính ở server, không
 * để mô hình tự đoán; mô hình chỉ viết lại thành một câu dễ đọc. Nhãn đánh giá
 * (rẻ, ngang, cao) cũng do server quyết, nên tên món người bán viết có chèn câu
 * lệnh cũng không đổi được nhãn.
 */
describe('marketPrice', () => {
  it('lấy giá giữa của các món cùng loại', () => {
    expect(marketPrice([300, 100, 200])).toBe(200);
    expect(marketPrice([100, 200, 300, 400])).toBe(250);
  });

  it('dưới 3 món thì không đủ để nói giá phổ biến', () => {
    expect(marketPrice([100, 200])).toBeNull();
  });
});

describe('baseReview', () => {
  const item = { price: 540000, condition: 'good' };

  it('rẻ hơn mặt bằng từ 15% trở lên là giá tốt', () => {
    const r = baseReview(item, 820000, 6);
    expect(r.verdict).toBe('good');
    expect(r.note).toContain('Rẻ hơn khoảng 34%');
    expect(r.note).toContain('820.000');
  });

  it('chênh dưới 15% là ngang mặt bằng', () => {
    expect(baseReview({ ...item, price: 860000 }, 820000, 6).verdict).toBe(
      'fair',
    );
  });

  it('cao hơn mặt bằng từ 15% trở lên thì nhắc xem kỹ', () => {
    const r = baseReview({ ...item, price: 1830000 }, 820000, 6);
    expect(r.verdict).toBe('high');
    expect(r.note).toContain('Cao hơn khoảng');
  });

  it('không đủ món để so thì chỉ nói tình trạng, không gắn nhãn giá', () => {
    const r = baseReview({ ...item, condition: 'like_new' }, null, 1);
    expect(r.verdict).toBeNull();
    expect(r.note).toContain('Như mới');
  });
});

describe('parseReviewNotes', () => {
  it('chỉ nhận id có trong danh sách, cắt câu dài, bỏ đường link', () => {
    const body = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              notes: [
                { id: 1, note: 'Giá tốt, xem https://lua-dao.example ngay' },
                { id: 99, note: 'món lạ' },
                { id: 2, note: 'x'.repeat(400) },
              ],
            }),
          },
        },
      ],
    });
    const m = parseReviewNotes(body, [1, 2]);
    expect(m.get(1)).not.toContain('http');
    expect(m.has(99)).toBe(false);
    expect(m.get(2)!.length).toBeLessThanOrEqual(160);
  });

  it('body hỏng thì trả rỗng, không ném lỗi', () => {
    expect(parseReviewNotes('not json', [1]).size).toBe(0);
  });
});
