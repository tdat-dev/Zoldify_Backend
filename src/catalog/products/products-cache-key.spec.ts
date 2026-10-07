import { ProductsService } from './products.service';

/**
 * Key cache danh sách phải đổi theo MỌI tham số lọc (pre-mortem C2).
 *
 * Bẫy đã dính lúc gộp nhánh prod vào staging (29/09): prod thêm lọc
 * `condition`, staging đã bọc findAll trong cache với key liệt kê tay từng
 * tham số. Gộp xong key thiếu `condition`, nên `GET /products?condition=new`
 * ngay sau `GET /products` nhận lại nguyên danh sách chưa lọc từ cache (và
 * ngược lại) trong suốt TTL. Không lỗi nào, chỉ sai kết quả.
 *
 * Không cần database: chỉ ghi lại key mà findAll đưa cho cache.
 */
describe('ProductsService.findAll: key cache', () => {
  const keys: string[] = [];
  const cache = {
    get: () => Promise.resolve(undefined),
    wrap: (key: string) => {
      keys.push(key);
      return Promise.resolve({ meta: {}, result: [] });
    },
  };
  const service = new ProductsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    cache as never,
  );

  beforeEach(() => (keys.length = 0));

  it('lọc theo tình trạng thì dùng key khác với không lọc', async () => {
    await service.findAll('1', '10', {});
    await service.findAll('1', '10', { condition: 'new' });
    await service.findAll('1', '10', { condition: 'used' });
    expect(new Set(keys).size).toBe(3);
  });

  it('cùng tham số thì cùng key (cache vẫn trúng)', async () => {
    await service.findAll('1', '10', { condition: 'new' });
    await service.findAll('1', '10', { condition: 'new' });
    expect(keys[0]).toBe(keys[1]);
  });
});
