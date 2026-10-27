import { Logger } from '@nestjs/common';
import { PaymentMethod } from '@common/enums/payment.enum';
import type { KenhThongBao } from '@common/kenh-thong-bao';

/** Thứ cần để đọc thông tin đơn: DataSource hoặc EntityManager đều có. */
interface ChayTruyVan {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

export type SuKienDon =
  | 'xac-nhan'
  | 'dang-giao'
  | 'giao-toi-cua'
  | 'da-giao'
  | 'huy-boi-nguoi-mua'
  | 'huy-boi-nguoi-ban'
  | 'huy-boi-admin'
  | 'huy-qua-han'
  | 'hoan-tien';

interface ThongTinDon {
  id: number;
  order_code: string;
  user_id: number;
  payment_method: string;
  is_paid: number;
  sellers: string | null;
}

interface MotTin {
  user_id: number;
  view: 'buyer' | 'seller';
  title: string;
  content: string;
}

/**
 * Báo cho người mua / người bán khi đơn đổi trạng thái.
 *
 * Tới 27/10 chỉ có bốn chỗ gửi thông báo đơn hàng (đặt hàng, đơn mới cho người
 * bán, người bán bị khoá, tiền về). Xác nhận, đang giao, đã giao, huỷ và hoàn
 * tiền thì im lặng: người mua chỉ biết đơn bị huỷ khi tự mở app, người bán
 * không biết người mua vừa huỷ đơn họ đang đóng gói. Đo bằng
 * `thong-bao-trang-thai-don.spec.ts`.
 *
 * HAI LUẬT KHÔNG ĐƯỢC PHÁ:
 *  1. Chỉ gọi SAU KHI trạng thái đã commit. Báo trước commit là báo một việc
 *     có thể bị quay lui ngay sau đó.
 *  2. KHÔNG BAO GIỜ NÉM. Mọi lỗi (đọc đơn, ghi thông báo, FCM) chỉ ghi log.
 *     Cùng nguyên tắc với thông báo đặt hàng trong `orders.service.ts`: hỏng
 *     thì mất thông báo, không mất thao tác. Một lần FCM chập mà làm API đổi
 *     trạng thái trả 500 thì người dùng bấm lại và nhận 400 "đã ở trạng thái
 *     đó rồi" cho một việc thực ra đã xong.
 *
 * Tự đọc thông tin đơn bằng một câu SQL thay vì nhận entity từ nơi gọi: mỗi
 * nơi gọi nạp đơn với một bộ quan hệ khác nhau (có nơi không nạp người mua,
 * lượt GHN chỉ có id lô), nạp thiếu một quan hệ là báo nhầm người.
 */
export class ThongBaoDon {
  constructor(
    private readonly kenh: KenhThongBao | undefined,
    private readonly db: ChayTruyVan,
    private readonly logger: Logger,
  ) {}

  /** Báo theo id lô hàng (lượt theo dõi GHN chỉ cầm id lô). */
  async baoTheoLo(loId: number, suKien: SuKienDon): Promise<void> {
    try {
      const rows = await this.db.query<Array<{ order_id: number }>>(
        'SELECT order_id FROM order_shipments WHERE id = ?',
        [loId],
      );
      if (rows[0]) await this.bao(Number(rows[0].order_id), suKien);
    } catch (err) {
      this.ghiLoi(`lô #${loId}`, suKien, err);
    }
  }

  async bao(orderId: number, suKien: SuKienDon): Promise<void> {
    if (!this.kenh) return;
    let tin: MotTin[];
    let don: ThongTinDon | undefined;
    try {
      // GROUP_CONCAT người bán: đơn C2C có thể gồm hàng nhiều người bán, và
      // mỗi người đều cần biết khi người mua huỷ hay đã nhận.
      const rows = await this.db.query<ThongTinDon[]>(
        `SELECT o.id, o.order_code, o.user_id, o.payment_method, o.is_paid,
                GROUP_CONCAT(DISTINCT p.seller_id) AS sellers
           FROM orders o
           LEFT JOIN order_items oi ON oi.order_id = o.id
           LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.id = ?
          GROUP BY o.id`,
        [orderId],
      );
      don = rows[0];
      if (!don) return;
      tin = soanTin(don, suKien);
    } catch (err) {
      this.ghiLoi(`đơn #${orderId}`, suKien, err);
      return;
    }

    // Mỗi người nhận một try riêng: một người lỗi không làm người kia mất tin.
    for (const t of tin) {
      try {
        await this.kenh.create({
          user_id: t.user_id,
          // Chuỗi thô chứ không import enum NotificationType: ordering không
          // được import messaging (xem `@common/kenh-thong-bao`).
          type: 'order_status' as never,
          title: t.title,
          content: t.content,
          data: { order_id: don.id, order_code: don.order_code, view: t.view },
        });
      } catch (err) {
        this.ghiLoi(`đơn ${don.order_code}, user ${t.user_id}`, suKien, err);
      }
    }
  }

  /**
   * Báo MỌI quản trị viên đang hoạt động rằng một vận đơn GHN gặp sự cố (hoàn
   * hàng, huỷ, thất lạc). Loại `system`, không phải `order_status`: người cần
   * hành động là admin, và màn của admin mở theo `order_id`.
   *
   * Báo tất cả admin chứ không chọn một: chưa có phân ca trực, và một tin đến
   * nhầm người thì vẫn hơn một đơn kẹt "Đang giao" không ai biết.
   */
  async baoAdminSuCoVanDon(loId: number, ghnStatus: string): Promise<void> {
    if (!this.kenh) return;
    try {
      const [lo] = await this.db.query<
        Array<{ order_id: number; order_code: string; tracking_code: string }>
      >(
        `SELECT s.order_id, o.order_code, s.tracking_code
           FROM order_shipments s
           JOIN orders o ON o.id = s.order_id
          WHERE s.id = ?`,
        [loId],
      );
      if (!lo) return;
      const admins = await this.db.query<Array<{ id: number }>>(
        `SELECT id FROM users
          WHERE role = 'admin' AND is_locked = 0 AND deleted_at IS NULL`,
      );
      for (const a of admins) {
        try {
          await this.kenh.create({
            user_id: Number(a.id),
            type: 'system' as never,
            title: 'Vận đơn GHN gặp sự cố',
            content:
              `Đơn ${lo.order_code}, vận đơn ${lo.tracking_code}: GHN báo ` +
              `"${ghnStatus}". Kiểm tra rồi quyết định giao lại hay hoàn tiền.`,
            data: {
              order_id: Number(lo.order_id),
              order_code: lo.order_code,
              shipment_id: loId,
              tracking_code: lo.tracking_code,
              ghn_status: ghnStatus,
              view: 'admin',
            },
          });
        } catch (err) {
          this.logger.warn(
            `Không báo được admin ${a.id} về sự cố vận đơn ${lo.tracking_code}: ` +
              `${(err as Error)?.message ?? String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Không báo được admin về sự cố lô #${loId}: ` +
          `${(err as Error)?.message ?? String(err)}`,
      );
    }
  }

  private ghiLoi(cho: string, suKien: SuKienDon, err: unknown): void {
    this.logger.warn(
      `Không gửi được thông báo "${suKien}" cho ${cho}: ` +
        `${(err as Error)?.message ?? String(err)}. Trạng thái đơn vẫn đã lưu.`,
    );
  }
}

/** Soạn nội dung. Thuần, không I/O, để đọc một chỗ là thấy hết lời gửi đi. */
function soanTin(don: ThongTinDon, suKien: SuKienDon): MotTin[] {
  const ma = don.order_code;
  const nguoiMua = Number(don.user_id);
  const nguoiBan = (don.sellers ?? '')
    .split(',')
    .map(Number)
    .filter((id) => id > 0 && id !== nguoiMua);
  const choMua = (title: string, content: string): MotTin[] =>
    nguoiMua ? [{ user_id: nguoiMua, view: 'buyer', title, content }] : [];
  const choBan = (title: string, content: string): MotTin[] =>
    nguoiBan.map((id) => ({ user_id: id, view: 'seller', title, content }));

  // Đơn đã trả tiền thì huỷ là hoàn ký quỹ về ví người mua (escrows.refund).
  // Nói rõ để người mua không phải nhắn hỏi "tiền tôi đâu".
  const tienHuy = Number(don.is_paid)
    ? ' Tiền đã được hoàn về ví Zoldify của bạn.'
    : '';

  switch (suKien) {
    case 'xac-nhan':
      return choMua(
        'Đơn hàng đã được xác nhận',
        `Người bán đã xác nhận đơn ${ma} và đang chuẩn bị hàng.`,
      );
    case 'dang-giao':
      return choMua(
        'Đơn hàng đang giao tới bạn',
        `Đơn ${ma} đã được giao cho đơn vị vận chuyển. Bạn để ý điện thoại nhé.`,
      );
    case 'giao-toi-cua':
      return choMua(
        'Hàng đã giao tới bạn',
        `Đơn ${ma} đã giao tới nơi. Kiểm tra hàng rồi bấm Đã nhận hàng để hoàn tất.`,
      );
    case 'da-giao':
      return [
        ...choMua(
          'Đơn hàng đã hoàn tất',
          `Đơn ${ma} đã giao xong. Cảm ơn bạn đã mua sắm trên Zoldify.`,
        ),
        ...choBan(
          'Đơn hàng đã giao xong',
          `Người mua đã nhận đơn ${ma}. Xem tiền hàng trong ví của bạn.`,
        ),
      ];
    case 'huy-boi-nguoi-mua':
      return choBan(
        'Người mua đã huỷ đơn',
        `Đơn ${ma} vừa bị người mua huỷ. Bạn không cần gửi hàng nữa.`,
      );
    case 'huy-boi-nguoi-ban':
      return choMua(
        'Đơn hàng đã bị huỷ',
        `Người bán đã huỷ đơn ${ma}.${tienHuy}`,
      );
    case 'huy-boi-admin':
      return choMua(
        'Đơn hàng đã bị huỷ',
        `Zoldify đã huỷ đơn ${ma}.${tienHuy}`,
      );
    case 'huy-qua-han':
      return [
        ...choMua(
          'Đơn hàng đã tự huỷ',
          `Đơn ${ma} quá hạn xử lý nên đã được huỷ.${tienHuy}`,
        ),
        ...choBan(
          'Đơn hàng đã tự huỷ',
          `Đơn ${ma} quá hạn xử lý nên hệ thống đã huỷ. Bạn không cần gửi hàng nữa.`,
        ),
      ];
    case 'hoan-tien': {
      // Đơn trả qua ví hoặc PayOS thì tiền hoàn đi qua sổ cái về ví Zoldify.
      // Đơn COD thì tiền mặt nằm ngoài hệ thống, không hứa "về ví" được.
      const veVi =
        don.payment_method === PaymentMethod.WALLET ||
        don.payment_method === PaymentMethod.PAYOS;
      return choMua(
        'Đơn hàng đã được hoàn tiền',
        veVi
          ? `Tiền đơn ${ma} đã được hoàn về ví Zoldify của bạn.`
          : `Đơn ${ma} đã được hoàn tiền. Cần hỗ trợ thì nhắn cho Zoldify nhé.`,
      );
    }
  }
}
