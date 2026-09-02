import { siteUrlChinh } from './site-url';

/**
 * Bài kiểm cho `siteUrlChinh` — viết TRƯỚC khi thay hai chỗ dùng.
 *
 * Trường hợp trung tâm là dòng "danh sách": đó là giá trị THẬT đang đặt trên
 * staging, và là thứ đã làm hỏng cả sitemap lẫn URL quay về của PayOS.
 */
describe('siteUrlChinh', () => {
  it('SITE_URL là danh sách → lấy phần tử đầu', () => {
    expect(
      siteUrlChinh(
        'https://staging.zoldify.com,https://admin-staging.zoldify.com',
      ),
    ).toBe('https://staging.zoldify.com');
  });

  it('có khoảng trắng quanh dấu phẩy vẫn cắt đúng', () => {
    expect(siteUrlChinh(' https://a.com , https://b.com ')).toBe(
      'https://a.com',
    );
  });

  it('một địa chỉ thì giữ nguyên', () => {
    expect(siteUrlChinh('https://zoldify.com')).toBe('https://zoldify.com');
  });

  it('cắt dấu / thừa ở cuối — chỗ gọi đều nối ${gốc}/đường-dẫn', () => {
    expect(siteUrlChinh('https://zoldify.com/')).toBe('https://zoldify.com');
    expect(siteUrlChinh('https://zoldify.com///')).toBe('https://zoldify.com');
  });

  it('rỗng / thiếu / null → mặc định localhost', () => {
    expect(siteUrlChinh('')).toBe('http://localhost:3001');
    expect(siteUrlChinh(undefined)).toBe('http://localhost:3001');
    expect(siteUrlChinh(null)).toBe('http://localhost:3001');
    expect(siteUrlChinh(',,,')).toBe('http://localhost:3001');
  });

  it('kết quả luôn là một URL hợp lệ, không chứa dấu phẩy', () => {
    for (const raw of [
      'https://staging.zoldify.com,https://admin-staging.zoldify.com',
      'https://zoldify.com/',
      '',
    ]) {
      const u = siteUrlChinh(raw);
      expect(u).not.toContain(',');
      expect(() => new URL(u)).not.toThrow();
    }
  });
});
