import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type Redis from 'ioredis';

/** Token tiêm cho client Redis dùng để PUBLISH. */
export const REDIS_PHAT = 'REDIS_PHAT_TON_KHO';

/**
 * Kênh Redis chở sự kiện tồn kho.
 *
 * Một kênh duy nhất cho mọi sản phẩm, không phải một kênh mỗi sản phẩm. Lọc
 * theo sản phẩm là việc của ROOM socket, ở phía gateway.
 *
 * Vì sao không `stock:<id>`: mỗi bản api sẽ phải `subscribe` thêm/bớt kênh mỗi
 * lần có người mở hay đóng một trang sản phẩm. Với 2011 sản phẩm và ba bản api
 * thì đó là hàng nghìn lệnh `SUBSCRIBE`/`UNSUBSCRIBE` chạy theo hành vi người
 * dùng — đắt hơn nhiều so với lọc trong bộ nhớ bằng room.
 */
export const KENH_TON_KHO = 'ton-kho';

/** Gói tin đi qua kênh. KHÔNG thêm trường nào khác — xem ghi chú ở `phat`. */
export interface TinTonKho {
  product_id: number;
  stock: number;
}

/**
 * Bên PHÁT của tồn kho real-time (task #26b).
 *
 * VÌ SAO QUA REDIS CHỨ KHÔNG GỌI THẲNG `server.emit`.
 *
 * Kho bị đổi ở ba chỗ, và một trong ba nằm ở tiến trình khác:
 *
 *   `orders.service.ts`    trừ kho khi đặt đơn      — api
 *   `orders.service.ts`    hoàn kho khi huỷ đơn     — api VÀ worker
 *   `products.service.ts`  người bán sửa kho tay    — api
 *
 * `worker` chạy `cancelExpired` mỗi giờ và nó hoàn kho, nhưng worker **không có
 * socket server** — `server.emit` ở đó là gọi vào `undefined`. Và kể cả trong
 * api: từ task #6 có BA bản api, nên một bản phát thì hai bản kia không biết
 * gì, và người đang nối vào bản khác không nhận được.
 *
 * Redis pub/sub giải cả hai: ai đổi kho cũng chỉ `publish`, mọi bản api đều
 * `subscribe` rồi tự phát cho client của mình.
 *
 * ĐÃ KIỂM VÀ LOẠI: TypeORM `EntitySubscriber`. Đường trừ kho chính đi bằng SQL
 * thô (`stock: () => 'stock - :soLuong'` trong `orders.service.ts`), mà
 * subscriber chỉ chạy với `save()`/`remove()` trên entity — nên đúng đường quan
 * trọng nhất sẽ không phát gì. Và dòng SQL đó **phải giữ nguyên**: nó là thứ
 * chặn lost update, `check:race` R1 gác nó.
 */
@Injectable()
export class StockEventsService {
  private readonly logger = new Logger(StockEventsService.name);

  /** Đã cảnh báo một lần chưa — xem `phat`. */
  private daCanhBao = false;

  constructor(
    @Optional() @Inject(REDIS_PHAT) private readonly redis: Redis | null,
  ) {}

  /**
   * Báo rằng tồn kho của một sản phẩm vừa đổi.
   *
   * **Gọi SAU KHI transaction đã commit.** Gọi bên trong transaction là phát
   * một con số có thể bị quay lui ngay sau đó, và client sẽ hiển thị tồn kho
   * không bao giờ tồn tại.
   *
   * **KHÔNG BAO GIỜ NÉM.** Cả ba chỗ gọi đều nằm ngay sau một transaction đã
   * commit thành công: đơn ĐÃ nằm trong database, kho ĐÃ trừ. Ném ở đây là biến
   * "đặt hàng xong nhưng không báo được cho người đang xem" thành "đặt hàng
   * lỗi" — hỏng một việc đã xong vì một việc trang trí.
   *
   * Gói tin chỉ có `product_id` và `stock`. Namespace `/stock` **cho phép
   * khách** (người chưa đăng nhập cũng xem trang sản phẩm), nên thêm
   * `sold_count`, `seller_id` hay giá là phát dữ liệu kinh doanh ra ngoài.
   */
  async phat(productId: number, stock: number): Promise<void> {
    if (!this.redis) {
      // Môi trường dev không bật Redis. Cảnh báo MỘT lần rồi im: mỗi lần đặt
      // hàng in một dòng thì log thành vô dụng đúng lúc cần đọc nó.
      if (!this.daCanhBao) {
        this.daCanhBao = true;
        this.logger.warn(
          'Không có Redis — tồn kho real-time tắt. Trang sản phẩm vẫn đúng ' +
            'khi tải lại, chỉ là không tự cập nhật.',
        );
      }
      return;
    }

    try {
      const tin: TinTonKho = { product_id: productId, stock };
      await this.redis.publish(KENH_TON_KHO, JSON.stringify(tin));
    } catch (e) {
      this.logger.warn(
        `Không phát được tồn kho sản phẩm ${productId}: ${(e as Error).message}`,
      );
    }
  }
}
