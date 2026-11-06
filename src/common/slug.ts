/**
 * Phải cho cùng kết quả với toSlug của web (Zoldify_Frontend/src/lib/slug.ts):
 * ký tự lạ bị BỎ chứ không thay bằng gạch, nên "1.5L" ra "15l". Sitemap từng
 * thay bằng gạch ra "1-5l", và URL nộp cho Google phải chuyển hướng thêm một bước.
 */
export function toSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
