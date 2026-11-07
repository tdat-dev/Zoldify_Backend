import { layDongLoi } from '../../scripts/nghiem-thu';

/**
 * 06/11 và 07/11 cổng `test` đỏ rồi chạy lại xanh, mà `nghiem-thu.md` chỉ còn
 * dòng `FAIL src/...`: không biết bài nào đỏ, đỏ vì gì, nên không tìm được gốc.
 */
describe('nghiem-thu giữ lại lỗi của jest', () => {
  const ra = [
    'PASS src/a.spec.ts',
    'FAIL src/b.spec.ts (7.826 s)',
    '  ● Console',
    '',
    '  ● Nhóm › bài đỏ thứ nhất',
    '',
    '    expect(received).toBe(expected)',
    '',
    '    Expected: 25',
    '    Received: 0',
    '',
    '  ● Nhóm › bài đỏ thứ hai',
    '',
    "    QueryFailedError: Unknown column 'x' in 'field list'",
    '',
    'Tests:       2 failed, 9 passed, 11 total',
  ].join('\n');

  it('có tên bài đỏ và nội dung lỗi, không có khối Console', () => {
    const kq = layDongLoi(ra);
    expect(kq).toContain('FAIL src/b.spec.ts');
    expect(kq).toContain('● Nhóm › bài đỏ thứ nhất');
    expect(kq).toContain('● Nhóm › bài đỏ thứ hai');
    expect(kq).toContain('Received: 0');
    expect(kq).toContain("QueryFailedError: Unknown column 'x'");
    expect(kq).not.toContain('● Console');
  });

  it('nhiều bài đỏ vẫn giữ tên trước, không để chi tiết chiếm hết chỗ', () => {
    const nhieu = Array.from(
      { length: 8 },
      (_, i) => `  ● Nhóm › bài ${i}\n\n    Expected: 1\n    Received: ${i}`,
    ).join('\n\n');
    const kq = layDongLoi(`FAIL src/b.spec.ts\n${nhieu}`);
    for (let i = 0; i < 8; i++) expect(kq).toContain(`● Nhóm › bài ${i}`);
  });
});
