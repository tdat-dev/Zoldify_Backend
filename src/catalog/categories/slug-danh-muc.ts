/**
 * Danh mục nằm ngay gốc URL của web (`/dien-thoai`), chung chỗ với route tĩnh. Next
 * ưu tiên route tĩnh, nên danh mục slug `cart` sẽ không bao giờ mở được, còn slug
 * có đuôi `-i5` bị web hiểu là món hàng số 5 (Zoldify_Frontend/src/lib/public-urls.ts).
 *
 * Danh sách phải khớp thư mục src/app của web. Thêm route tĩnh mới thì thêm ở đây.
 */
const ROUTE_CUA_WEB = new Set([
  'addresses',
  'admin',
  'api',
  'cart',
  'category',
  'chat',
  'checkout',
  'forgot-password',
  'images',
  'login',
  'maintenance',
  'media',
  'payment',
  'product',
  'profile',
  'register',
  'reset-password',
  'search',
  'shop',
  'uploads',
  'wallet',
]);

export function slugDungRouteWeb(slug: string): boolean {
  const thuong = slug.toLowerCase();
  return ROUTE_CUA_WEB.has(thuong) || /-i[1-9]\d*$/.test(thuong);
}
