import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { KENH_TON_KHO, type TinTonKho } from './stock-events.service';

/** Tên sự kiện gửi xuống client. */
export const SU_KIEN_TON_KHO = 'ton-kho';

/** Room của một sản phẩm. Một chỗ duy nhất sinh ra tên này. */
export const room = (productId: number) => `product_${productId}`;

/**
 * TỒN KHO REAL-TIME — bên NHẬN (task #26b).
 *
 * NAMESPACE RIÊNG `/stock`, KHÔNG đụng `chat.gateway.ts`.
 *
 * Hai namespace có hai luật xác thực ngược nhau: `/chat` bắt buộc token và từ
 * 28/09 còn kiểm `token_version` lẫn tài khoản bị khoá (audit B-04). Namespace
 * này thì **cho phép khách** — người chưa đăng nhập cũng xem trang sản phẩm, và
 * tồn kho là con số đã hiện công khai ngay trên trang đó.
 *
 * Nhét chung một gateway là sớm muộn cũng có người nới lỏng guard của `/chat`
 * cho `/stock` chạy được. Tách ra thì không ai phải chọn.
 *
 * ĐỔI LẠI, namespace này KHÔNG được mang gì ngoài `{product_id, stock}` — xem
 * `StockEventsService.phat`.
 *
 * ROOM THEO TỪNG SẢN PHẨM, KHÔNG PHÁT TOÀN SÀN. Sàn có 2011 sản phẩm; phát mọi
 * thay đổi cho mọi người đang mở web là bão broadcast, và mỗi client phải tự
 * lọc ra một con số nó cần. Client `join` khi mở trang, `leave` khi rời.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/stock' })
export class StockGateway {
  private readonly logger = new Logger(StockGateway.name);

  @WebSocketServer()
  server: Server;

  /**
   * Một gói tin từ kênh Redis `ton-kho` → phát vào đúng room.
   *
   * Public để bài kiểm gọi thẳng được: dựng cả Redis thật chỉ để chứng minh
   * "phát đúng room" là trả giá hạ tầng cho một phép kiểm nằm trọn trong mã.
   * Phần "Redis có chuyển được gói tin không" thì `npm run check:stock` lo.
   *
   * KHÔNG BAO GIỜ NÉM. Redis là kênh chung: một tiến trình khác publish nhầm
   * vào đây thì cả ba bản api cùng chết nếu không bắt lỗi ở đây.
   */
  nhanTuRedis(tinThô: string): void {
    let tin: TinTonKho;
    try {
      tin = JSON.parse(tinThô) as TinTonKho;
    } catch {
      this.logger.warn(`Gói tin ${KENH_TON_KHO} không phải JSON, bỏ qua`);
      return;
    }

    if (typeof tin?.product_id !== 'number' || typeof tin?.stock !== 'number') {
      this.logger.warn(
        `Gói tin ${KENH_TON_KHO} thiếu product_id hoặc stock, bỏ qua`,
      );
      return;
    }

    this.server
      ?.to(room(tin.product_id))
      .emit(SU_KIEN_TON_KHO, { product_id: tin.product_id, stock: tin.stock });
  }

  /** Client mở trang sản phẩm. */
  @SubscribeMessage('theo-doi')
  theoDoi(
    @MessageBody() data: { product_id?: unknown },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean } {
    const id = Number(data?.product_id);
    // Không kiểm sản phẩm có tồn tại không: làm vậy là thêm một truy vấn
    // database cho mỗi lượt mở trang, để đổi lấy việc chặn ai đó join một room
    // rỗng — mà room rỗng thì không bao giờ có gói tin nào.
    if (!Number.isInteger(id) || id <= 0) return { ok: false };
    void client.join(room(id));
    return { ok: true };
  }

  /** Client rời trang sản phẩm. */
  @SubscribeMessage('thoi-theo-doi')
  thoiTheoDoi(
    @MessageBody() data: { product_id?: unknown },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean } {
    const id = Number(data?.product_id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false };
    void client.leave(room(id));
    return { ok: true };
  }
}
