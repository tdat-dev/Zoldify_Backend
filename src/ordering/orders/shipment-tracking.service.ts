import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { timingSafeEqual } from 'crypto';
import { GhnService } from '@ordering/ghn/ghn.service';
import { OrderShipment, ShipmentStatus } from './entities/order-shipment.entity';

/**
 * "GHN nói gì về lô hàng này" — MỘT chỗ duy nhất, hai đường vào.
 *
 * Đường nhanh: webhook GHN gọi ngay khi trạng thái đổi (task #26).
 * Lưới an toàn: worker quét định kỳ mỗi giờ (task #14).
 *
 * VÌ SAO GIỮ CẢ HAI. Webhook nhanh nhưng không đảm bảo tới: GHN có thể gọi lúc
 * máy chủ đang deploy, mạng rớt, hoặc URL cấu hình sai. Mất một sự kiện
 * "đã giao" nghĩa là escrow người bán không bao giờ được giải ngân — hỏng câm,
 * không ai báo. Nên lượt quét định kỳ ở lại làm lưới: chậm nhất một giờ là bắt
 * được thứ webhook đánh rơi.
 *
 * VÌ SAO TÁCH KHỎI OrdersService. Không phải để cho gọn — mà để bài kiểm dựng
 * được. `OrdersService` có mười phụ thuộc (escrow, payos, giỏ, sản phẩm...);
 * muốn kiểm một lượt webhook thì phải dựng cả chuỗi đó. Lớp này chỉ cần repo
 * lô hàng và GhnService, nên `shipment-tracking.service.spec.ts` dựng nó bằng
 * hai dòng và chạy trên database thật.
 */
@Injectable()
export class ShipmentTrackingService {
  private readonly logger = new Logger(ShipmentTrackingService.name);

  constructor(
    @InjectRepository(OrderShipment)
    private readonly shipments: Repository<OrderShipment>,
    private readonly ghn: GhnService,
  ) {}

  /**
   * Cửa đầu tiên: token bí mật trong URL webhook.
   *
   * GHN không ký payload như PayOS, và bảng điều khiển của họ chỉ cho khai một
   * URL callback — không đặt được header riêng. Nên bí mật buộc phải nằm trong
   * chính URL.
   *
   * `timingSafeEqual` chứ không `===`: so sánh chuỗi thường thoát ra ngay ký tự
   * đầu khác nhau, nên thời gian trả lời rò rỉ token đúng được bao nhiêu ký tự.
   * Dò từng ký tự một thì token 32 ký tự chỉ còn vài nghìn lần thử thay vì
   * 62^32. Đây là endpoint dẫn tới tiền, không đáng tiết kiệm chỗ này.
   */
  private kiemToken(token: string | undefined): void {
    const dung = process.env.GHN_WEBHOOK_TOKEN ?? '';

    // Chưa cấu hình thì ĐÓNG, không mở. Một webhook tiền mà để trống biến môi
    // trường là mở toang; thà 401 hết và người deploy phải điền.
    if (!dung) {
      this.logger.error('GHN_WEBHOOK_TOKEN chưa đặt — từ chối mọi webhook.');
      throw new UnauthorizedException('Webhook chưa được cấu hình');
    }

    const a = Buffer.from(token ?? '', 'utf8');
    const b = Buffer.from(dung, 'utf8');
    // timingSafeEqual ném khi hai buffer khác độ dài, nên phải chặn trước.
    // Độ dài token thì không phải bí mật đáng giá.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token webhook không hợp lệ');
    }
  }

  /**
   * Chuyển một lô sang "đã giao". ĐÂY LÀ BẢN DUY NHẤT — webhook và lượt quét
   * định kỳ đều đi qua đây.
   *
   * Có bản sao thứ hai là chuyện đã xảy ra thật trong repo này: `TasksService`
   * từng chép lại đường huỷ đơn của `OrdersService` và chép kèm cả lỗi, để tiền
   * người mua kẹt trong `escrow_hold` không lối ra. Bài học ghi ở đầu
   * `tasks.service.ts` là "đừng có bản sao thứ hai", nên ở đây không tạo cái nào.
   *
   * Chỉ đi MỘT chiều `CREATED → DELIVERED`. Hai lý do:
   *   - GHN gửi lại (retry) thì lần hai không ghi đè `delivered_at`, nếu không
   *     cửa sổ tự-xác-nhận bị đẩy lùi mỗi lần GHN gọi lại.
   *   - Webhook tới sai thứ tự thì không kéo `RECEIVED` (đã giải ngân) ngược về
   *     `DELIVERED` — trạng thái cuối phải là cuối.
   */
  private async danhDauDaGiao(lo: OrderShipment): Promise<boolean> {
    if (lo.status !== ShipmentStatus.CREATED) return false;
    lo.status = ShipmentStatus.DELIVERED;
    lo.delivered_at = new Date();
    await this.shipments.save(lo);
    return true;
  }

  /**
   * Một lượt webhook từ GHN.
   *
   * ĐIỀU QUAN TRỌNG NHẤT TRONG HÀM NÀY: thân request KHÔNG được tin.
   *
   * GHN gửi kèm trạng thái, nhưng nếu lấy thẳng trạng thái đó mà ghi vào
   * database thì bí mật trong URL là thứ DUY NHẤT chặn giữa kẻ lạ và tiền ký
   * quỹ — mà URL thì nằm trong log máy chủ, log proxy, lịch sử trình duyệt của
   * người cấu hình. Rò một lần là rò vĩnh viễn.
   *
   * Nên webhook ở đây chỉ là TÍN HIỆU "có gì đó đổi, đi xem đi". Trạng thái
   * thật lấy bằng cách gọi ngược `getOrderStatus` hỏi chính GHN. Kẻ giả mạo
   * biết cả URL lẫn mã vận đơn thì cùng lắm làm hệ thống tốn một request sang
   * GHN — không dịch chuyển được một đồng nào.
   *
   * Trả 200 cho gần như mọi trường hợp (trừ token sai): webhook trả lỗi là GHN
   * xếp hàng gửi lại, và gửi lại một mã mình không quản lý thì lặp vô ích mãi.
   */
  async xuLyWebhook(
    token: string | undefined,
    body: Record<string, any>,
  ): Promise<{ known: boolean; updated: boolean }> {
    this.kiemToken(token);

    // GHN đặt tên trường không thống nhất giữa các bản tài liệu; nhận cả bốn
    // cách viết đã gặp thay vì cãi nhau với nhà cung cấp lúc production đang lỗi.
    const ma: string | undefined =
      body?.OrderCode ?? body?.order_code ?? body?.ClientOrderCode ?? body?.CodeGHN;

    if (!ma) {
      this.logger.warn('Webhook GHN không có mã vận đơn — bỏ qua.');
      return { known: false, updated: false };
    }

    const lo = await this.shipments.findOne({ where: { tracking_code: ma } });
    if (!lo) {
      // Không phải lỗi: GHN có thể gửi cho vận đơn của môi trường khác dùng
      // chung tài khoản (staging và production cùng một shop GHN).
      this.logger.warn(`Webhook GHN cho mã lạ ${ma} — bỏ qua.`);
      return { known: false, updated: false };
    }

    // Đã ở trạng thái cuối thì khỏi làm phiền GHN.
    if (lo.status !== ShipmentStatus.CREATED) {
      return { known: true, updated: false };
    }

    let thuc: string | null;
    try {
      thuc = await this.ghn.getOrderStatus(ma);
    } catch (err) {
      // Hỏi lại GHN không được thì DỪNG, không đoán. Lượt quét định kỳ mỗi giờ
      // sẽ thử lại — chậm hơn nhưng không sai.
      this.logger.error(
        `Không hỏi lại được GHN cho ${ma}: ${(err as Error).message}. ` +
          'Để lượt đồng bộ định kỳ xử lý.',
      );
      return { known: true, updated: false };
    }

    if (thuc !== 'delivered') {
      this.logger.log(`Webhook ${ma}: GHN đang báo "${thuc}", chưa chốt.`);
      return { known: true, updated: false };
    }

    const doi = await this.danhDauDaGiao(lo);
    if (doi) this.logger.log(`Webhook GHN: lô ${ma} chuyển sang đã giao.`);
    return { known: true, updated: doi };
  }

  /**
   * Lượt quét định kỳ — lưới an toàn cho webhook, chạy trong tiến trình worker.
   *
   * KHÔNG giải ngân ở đây: "đã giao tới cửa" chưa phải "người mua đã nhận và
   * ưng". Việc chốt tiền để cho `autoConfirmDueShipments` (sau N ngày) hoặc
   * người mua bấm tay.
   */
  async dongBoTatCa(): Promise<{ checked: number; delivered: number }> {
    const ds = await this.shipments.find({
      where: { status: ShipmentStatus.CREATED, tracking_code: Not(IsNull()) },
    });

    let delivered = 0;
    for (const lo of ds) {
      if (!lo.tracking_code) continue;
      try {
        if ((await this.ghn.getOrderStatus(lo.tracking_code)) === 'delivered') {
          if (await this.danhDauDaGiao(lo)) delivered += 1;
        }
      } catch (err) {
        // Một lô hỏng không được làm chết cả lượt — lô sau vẫn phải được xét.
        this.logger.error(
          `Đồng bộ trạng thái GHN lỗi (vận đơn ${lo.tracking_code}): ${(err as Error).message}`,
        );
      }
    }
    return { checked: ds.length, delivered };
  }
}
