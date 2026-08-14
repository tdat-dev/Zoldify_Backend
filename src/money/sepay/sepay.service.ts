import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '@ordering/orders/entities/order.entity';
import * as CryptoJS from 'crypto-js';

@Injectable()
export class SepayService {
  private readonly logger = new Logger(SepayService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  /**
   * Xác thực chữ ký HMAC từ Sepay
   *
   * @param signature - Giá trị trong header X-Signature
   * @param body - Raw body string (chưa parse JSON)
   * @returns true nếu hợp lệ, false nếu không
   */
  verifySignature(signature: string, body: string): boolean {
    const secret = process.env.SEPAY_WEBHOOK_SECRET || '';

    /**
     * CHƯA CẤU HÌNH SECRET THÌ TỪ CHỐI, KHÔNG PHẢI CHO QUA.
     *
     * Bản trước tính HMAC với khoá rỗng rồi so sánh như thường. Nhưng HMAC
     * khoá rỗng thì ai cũng tính được — chẳng còn gì bí mật để mà đoán. Nghĩa
     * là bất kỳ ai biết URL này đều tự ký được một webhook hợp lệ, và đánh dấu
     * đơn hàng "đã thanh toán" mà không trả một đồng nào.
     *
     * Đã thử thật trên máy này lúc biến còn trống: gửi chữ ký tự chế bằng khoá
     * rỗng, server trả 200 và đi tiếp vào xử lý (chỉ dừng vì payload thử
     * nghiệm cố tình không chứa mã đơn).
     *
     * Thiếu cấu hình phải là CỬA ĐÓNG. Mở cửa vì chưa ai đặt khoá là kiểu hỏng
     * tệ nhất: im lặng, và chỉ lộ ra khi đã mất tiền.
     */
    if (!secret) {
      this.logger.error(
        'SEPAY_WEBHOOK_SECRET đang trống — từ chối mọi webhook SePay. ' +
          'Đặt biến này rồi khởi động lại nếu thật sự muốn dùng SePay.',
      );
      return false;
    }

    // Tính HMAC-SHA256 với secret và body
    const computed = CryptoJS.HmacSHA256(body, secret).toString();

    // So sánh chữ ký từ Sepay với chữ ký tự tính
    return signature === computed;
  }

  /**
   * Xử lý webhook từ Sepay
   * Khi có người chuyển khoản, Sepay gửi thông báo về đây
   */
  async handleWebhook(payload: any) {
    // Bước 1: Lấy nội dung chuyển khoản
    // Content từ Sepay có dạng: "Thanh toan don hang ORD-20260601-001"
    const content: string = payload.content || '';

    // Bước 2: Tìm mã đơn hàng trong nội dung chuyển khoản
    // Dùng regex tìm order_code (VD: ORD-20260601-001)
    const match = content.match(/ORD-\d{4}\d{2}\d{2}-\d{3}/);

    if (!match) {
      // Không tìm thấy mã đơn hàng → vẫn trả 200 để Sepay không gửi lại
      return {
        received: true,
        processed: false,
        reason: 'No order code found',
      };
    }

    const orderCode = match[0];

    // Bước 3: Tìm đơn hàng trong DB
    const order = await this.orderRepository.findOne({
      where: { order_code: orderCode },
    });

    if (!order) {
      return { received: true, processed: false, reason: 'Order not found' };
    }

    if (order.is_paid) {
      return { received: true, processed: false, reason: 'Already paid' };
    }

    // Bước 4: Kiểm tra số tiền có khớp không
    const amount = payload.transferAmount || 0;
    const expectedAmount = Number(order.final_amount);

    if (amount < expectedAmount) {
      // Chuyển thiếu tiền → vẫn ghi nhận nhưng không đánh dấu paid
      return { received: true, processed: false, reason: 'Amount mismatch' };
    }

    // Bước 5: Đánh dấu đơn hàng đã thanh toán
    await this.orderRepository.update(order.id, {
      is_paid: true,
      paid_at: new Date(),
    });

    console.log(`✅ Order ${orderCode} marked as paid via Sepay`);

    return { received: true, processed: true };
  }
}
