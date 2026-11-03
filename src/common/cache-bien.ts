// Khung rỗng để bài kiểm đỏ chạy được tới từng khẳng định (thay vì chết ở
// "Cannot find module"). Bản thật ở commit kế tiếp.
export const CACHE_BIEN = 'CACHE_BIEN';

export function CacheBien(_giay?: number): MethodDecorator {
  return () => undefined;
}
