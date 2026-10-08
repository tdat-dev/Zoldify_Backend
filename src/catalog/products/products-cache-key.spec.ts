import { ProductsService } from './products.service';

/**
 * Stub của `StockEventsService` cho mọi chỗ tự new service thay vì để bộ tiêm phụ thuộc dựng.
 *
 * VÌ SAO PHẢI CÓ, KHI npm test ĐÃ XANH MÀ KHÔNG CÓ NÓ.
 *
 * Đo ngày 07/10: thiếu đối số này, ts-jest KHÔNG báo lỗi TS2554 — bốn spec vẫn
 * xanh với this.stockEvents === undefined, và chỉ nổ vào ngày có người thêm một
 * ca chạm tới đường dẫn gọi phat(). Cùng khiếm khuyết đó thì ts-node (dùng cho
 * scripts/) BÁO NGAY, nên check:cache đỏ còn npm test xanh — hai công cụ, hai
 * câu trả lời, cho cùng một dòng mã.
 *
 * resolve chứ không reject: cả ba chỗ gọi đều await nó, và chúng nằm NGAY SAU
 * khi transaction đã commit.
 */
const khoPhat = { phat: () => Promise.resolve() } as never;

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
    khoPhat,
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
