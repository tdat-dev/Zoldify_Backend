import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * ID TRÊN ĐƯỜNG DẪN PHẢI QUA ParseIntPipe (issue #42).
 *
 * Đo staging 12/11: `/cart/abc`, `/orders/abc`, `/addresses/abc` và khoảng hai
 * chục route khác trả **500** "Không ghi được dữ liệu lúc này", vì controller
 * nhận `@Param('id') id: string` rồi ép `+id` thành `NaN` và đẩy xuống câu SQL.
 * Chỉ `products.controller` dùng `ParseIntPipe` nên `/products/abc` ra đúng 400.
 *
 * Bài kiểm đọc mã nguồn các controller: mọi tham số tên `id` hoặc kết thúc bằng
 * `Id` phải có `ParseIntPipe`. Đọc mã chứ không gọi từng route, để route MỚI
 * thêm sau này cũng bị chặn mà không ai phải nhớ thêm ca kiểm.
 */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

describe('ID trên đường dẫn phải qua ParseIntPipe', () => {
  it('không còn @Param id dạng chuỗi nào', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of controllerFiles(root)) {
      const src = readFileSync(file, 'utf8');
      // @Param('id') id: string  |  @Param('sellerId') sellerId: string
      const re = /@Param\(\s*'(\w*(?:id|Id))'\s*\)/g;
      for (const m of src.matchAll(re)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${relative(root, file)}:${line} @Param('${m[1]}')`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
