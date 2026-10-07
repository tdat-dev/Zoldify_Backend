import { StockEventsService, KENH_TON_KHO } from './stock-events.service';
import { StockGateway } from './stock.gateway';

/**
 * TỒN KHO REAL-TIME (task #26b) — phần không cần Redis thật.
 *
 * VÌ SAO QUA REDIS PUB/SUB CHỨ KHÔNG GỌI THẲNG `server.emit`.
 *
 * Kho bị đổi ở BA chỗ, và một trong ba nằm ở tiến trình khác:
 *
 *   orders.service.ts:494    trừ kho khi đặt đơn        (api)
 *   orders.service.ts        hoàn kho khi huỷ đơn       (api VÀ worker)
 *   products.service.ts:650  người bán sửa kho tay      (api)
 *
 * `worker` chạy `cancelExpired` mỗi giờ và nó hoàn kho — nhưng worker **không có
 * socket server**, nên `server.emit` ở đó là gọi vào `undefined`. Và kể cả
 * trong api: từ task #6 có BA bản api, nên một bản phát thì hai bản kia không
 * biết gì, và người dùng đang nối vào bản khác sẽ không nhận được.
 *
 * Redis pub/sub giải cả hai: ai đổi kho cũng chỉ `publish`, mọi bản api đều
 * `subscribe` và tự phát cho client của mình.
 *
 * VÌ SAO BÀI KIỂM NÀY MOCK REDIS. Thứ cần chứng minh ở đây là HÌNH DẠNG: phát
 * đúng kênh, đúng room, đúng hai trường, và không nổ khi Redis chết. Cả bốn đều
 * nằm trong mã TypeScript. Việc "Redis thật có chuyển được gói tin không" thì
 * `npm run check:stock` lo, và nó dựng app thật + socket thật + đặt đơn thật.
 */
describe('Tồn kho real-time — hình dạng sự kiện', () => {
  describe('StockEventsService — bên phát', () => {
    it('phát đúng kênh, và CHỈ hai trường product_id + stock', async () => {
      const daGui: Array<[string, string]> = [];
      const redis = {
        publish: (kenh: string, tin: string) => {
          daGui.push([kenh, tin]);
          return Promise.resolve(1);
        },
      };
      const svc = new StockEventsService(redis as never);

      await svc.phat(42, 7);

      expect(daGui).toHaveLength(1);
      const [kenh, tin] = daGui[0];
      expect(kenh).toBe(KENH_TON_KHO);
      // Namespace `/stock` CHO PHÉP KHÁCH (người chưa đăng nhập cũng xem trang
      // sản phẩm). Nên gói tin không được mang gì ngoài hai số này — thêm
      // `sold_count` hay `seller_id` là phát dữ liệu kinh doanh ra ngoài.
      expect(JSON.parse(tin)).toEqual({ product_id: 42, stock: 7 });
    });

    it('Redis chết thì KHÔNG làm hỏng việc gọi nó', async () => {
      // Ba chỗ phát đều nằm ngay sau khi transaction đã commit. Ném ở đây là
      // biến "đặt hàng xong nhưng không báo được" thành "đặt hàng lỗi" — trong
      // khi đơn ĐÃ nằm trong database và kho ĐÃ trừ.
      const redis = {
        publish: () =>
          Promise.reject(new Error("Stream isn't writeable")),
      };
      const svc = new StockEventsService(redis as never);

      await expect(svc.phat(1, 1)).resolves.toBeUndefined();
    });

    it('không có Redis thì bỏ qua, không ném', async () => {
      const svc = new StockEventsService(null);
      await expect(svc.phat(1, 1)).resolves.toBeUndefined();
    });
  });

  describe('StockGateway — bên nhận', () => {
    function dungGateway() {
      const daPhat: Array<{ room: string; su_kien: string; data: unknown }> = [];
      const server = {
        to: (room: string) => ({
          emit: (su_kien: string, data: unknown) =>
            daPhat.push({ room, su_kien, data }),
        }),
      };
      const gw = new StockGateway();
      gw.server = server as never;
      return { gw, daPhat };
    }

    it('phát vào ĐÚNG room của sản phẩm, không phát toàn sàn', () => {
      const { gw, daPhat } = dungGateway();

      gw.nhanTuRedis(JSON.stringify({ product_id: 42, stock: 7 }));

      expect(daPhat).toEqual([
        { room: 'product_42', su_kien: 'ton-kho', data: { product_id: 42, stock: 7 } },
      ]);
    });

    it('gói tin hỏng thì bỏ qua, không làm chết tiến trình', () => {
      const { gw, daPhat } = dungGateway();

      // Redis là kênh chung; một tiến trình khác publish nhầm vào đây thì cả
      // ba bản api cùng chết nếu không bắt lỗi.
      gw.nhanTuRedis('{khong-phai-json');
      gw.nhanTuRedis(JSON.stringify({ thieu: 'product_id' }));

      expect(daPhat).toHaveLength(0);
    });
  });
});
