import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { LedgerService } from '@money/ledger/ledger.service';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';
import { EscrowsService } from '@money/escrows/escrows.service';
import { PayOS } from '@payos/node';
import type { PaymentLink, WebhookData } from '@payos/node';
import { Payment } from '@money/payments/entities/payment.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import {
  PaymentStatus,
  PaymentType,
  PaymentMethod,
} from '@common/enums/payment.enum';
import { OrderStatus } from '@ordering/orders/entities/order.entity';
import { User, UserRole } from '@identity/users/entities/user.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { NotificationType } from '@messaging/notifications/entities/notification.entity';
import { siteUrlChinh } from '@common/site-url';
import type { IUser } from '@identity/users/users.interface';

/**
 * Đơn ở các trạng thái này không nhận tiền vào ký quỹ nữa: tiền PayOS về trễ
 * thì vào ví người mua. Cùng danh sách mà `createOrderPaymentLink` dùng để
 * không phát link mới, và trả bằng ví cũng dùng đúng danh sách này
 * (`PaymentsService`): hai cổng tiền khác luật thì người mua bị một cổng từ
 * chối, cổng kia nhận, cho cùng một đơn (review 7).
 */
export const KHONG_NHAN_TIEN_DON: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
  OrderStatus.DELIVERED,
];

/**
 * Gốc của orderCode PayOS: orderCode = PAYOS_MA_GOC + payments.id.
 *
 * VÌ SAO CẦN MỘT DÃY SỐ RIÊNG. PayOS bắt orderCode duy nhất trên TOÀN tài
 * khoản merchant, kể cả link đã hết hạn hay đã huỷ. Trước 26/10:
 *   · đơn hàng dùng `orderCode = order.id`: link đầu hết hạn sau 15 phút là
 *     đơn đó KHÔNG BAO GIỜ tạo được link mới (PayOS báo "đã tồn tại");
 *   · nạp ví dùng `Number(7 số cuối Date.now + userId)`: lặp lại sau 10^7 ms
 *     (2 giờ 47 phút), và đồng hồ kết thúc bằng 0000000 thì ra đúng userId,
 *     tức đúng mã của đơn có id bằng userId.
 * `payments.id` là auto-increment, mỗi lần tạo link một dòng mới, đơn và nạp
 * ví chung một bảng: duy nhất theo cấu tạo, không cần đếm số lần thử.
 *
 * VÌ SAO CỘNG 10^13. Tránh mọi mã PayOS đã giữ theo hai công thức cũ: mã đơn
 * cũ là order.id (cột int, < 2,2 tỉ), mã nạp ví cũ là 7 chữ số ghép userId,
 * nhỏ hơn 10^13 khi userId dưới 1 triệu. Trần của PayOS là
 * Number.MAX_SAFE_INTEGER (~9·10^15), còn chỗ cho gần 9·10^15 lần tạo link.
 */
export const PAYOS_MA_GOC = 10_000_000_000_000;

@Injectable()
export class PayosService {
  private readonly logger = new Logger(PayosService.name);
  private payos: PayOS;
  /**
   * true khi không có PAYOS_CHECKSUM_KEY (thiếu hoặc toàn khoảng trắng).
   *
   * Khoá này là thứ DUY NHẤT phân biệt webhook thật của PayOS với một request
   * ai đó tự dựng. Bản trước ép khoá thiếu thành '' rồi giao cho SDK, và việc
   * chữ ký giả bị từ chối chỉ còn dựa vào một dòng bên trong @payos/node 2.0.5
   * (`!key.length` thì trả null). Đổi bản SDK là webhook cộng tiền mở toang mà
   * không ai biết. Giờ webhookKhongCoKhoa quyết định ở mã của mình: thiếu khoá
   * thì từ chối MỌI webhook. Không ném lúc khởi động vì máy chủ thiếu khoá PayOS
   * vẫn phải bán được đơn COD; thay vào đó log lỗi ngay khi dựng service.
   */
  private readonly webhookKhongCoKhoa: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    // Bảng payos_webhook_log KHÔNG còn được ghi nữa. Vai trò chống trùng của
    // nó đã chuyển sang ledger_transactions.idempotency_key, nơi khoá nằm
    // trong CÙNG transaction với việc cộng tiền. Bảng cũ giữ lại vì còn dữ
    // liệu lịch sử; xoá bằng migration riêng khi không cần tra cứu nữa.
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly escrowsService: EscrowsService,
  ) {
    const clientId = this.configService.get<string>('PAYOS_CLIENT_ID') || '';
    const apiKey = this.configService.get<string>('PAYOS_API_KEY') || '';
    const checksumKey =
      this.configService.get<string>('PAYOS_CHECKSUM_KEY') || '';
    this.webhookKhongCoKhoa = !checksumKey.trim();
    if (this.webhookKhongCoKhoa) {
      this.logger.error(
        'Thiếu PAYOS_CHECKSUM_KEY: mọi webhook PayOS sẽ bị từ chối, thanh ' +
          'toán qua PayOS sẽ không tự ghi nhận. Đặt khoá trong biến môi trường.',
      );
    }
    const baseURL =
      this.configService.get<string>('PAYOS_HOST') ||
      'https://api-merchant.payos.vn';

    this.payos = new PayOS({ clientId, apiKey, checksumKey, baseURL });
  }

  // ============ ORDER PAYMENT ============

  async createOrderPaymentLink(orderId: number, userId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['user'],
    });
    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    if (order.user.id !== userId) {
      throw new BadRequestException(
        'Bạn không có quyền thanh toán đơn hàng này',
      );
    }
    if (order.is_paid) {
      throw new BadRequestException('Đơn hàng đã được thanh toán');
    }

    // KHÔNG MỞ CỔNG TRẢ TIỀN CHO ĐƠN ĐÃ ĐÓNG.
    //
    // Tới 25/09 hàm này không nhìn `order.status` một lần nào, nên người mua
    // huỷ đơn xong vẫn tạo được link mới và trả tiền vào đó.
    //
    // `applyPaidPayment` có lưới đỡ cho trường hợp ấy — tiền về ví người mua
    // thay vì hồi sinh đơn (xem nhánh `paidAfterCancel`). Nhưng đó là lưới
    // CUỐI, dành cho link đã phát trước khi đơn bị huỷ và không đóng kịp. Mở
    // một cổng MỚI cho đơn đã huỷ thì không có lý do nào biện minh: người mua
    // trả tiền cho một thứ không còn tồn tại, rồi phải tự đi rút lại.
    //
    // `cancel()` đã gọi `voidOpenLinkForOrder` để đóng link cũ. Thiếu dòng này
    // thì công đóng đó vô nghĩa — bấm tạo link lần nữa là có cổng mới.
    const daDong: OrderStatus[] = [
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
      OrderStatus.DELIVERED,
    ];
    if (daDong.includes(order.status)) {
      throw new BadRequestException(
        `Đơn hàng đang ở trạng thái "${order.status}" nên không tạo được link ` +
          'thanh toán. Đơn đã huỷ thì đặt lại đơn mới.',
      );
    }

    const frontendUrl = siteUrlChinh(
      this.configService.get<string>('SITE_URL'),
    );

    // Lưu dòng payment TRƯỚC để lấy id làm orderCode (xem PAYOS_MA_GOC). Dòng
    // này tồn tại trước khi link tới tay người mua, nên webhook nào tới cũng
    // tìm thấy nó theo `payos_order_code`.
    const payment = await this.paymentRepository.save(
      this.paymentRepository.create({
        order: { id: order.id },
        user: { id: userId },
        amount: order.final_amount,
        payment_method: PaymentMethod.PAYOS,
        status: PaymentStatus.PENDING,
        type: PaymentType.ORDER_PAYMENT,
      }),
    );

    // Tạo payment link qua PayOS
    const link = await this.taoLinkHoacDanhDauHong(payment, {
      orderCode: PAYOS_MA_GOC + payment.id,
      amount: Math.round(Number(order.final_amount)),
      description: `DH${order.id}`.slice(0, 9),
      returnUrl: `${frontendUrl}/payment/return?orderId=${order.id}`,
      cancelUrl: `${frontendUrl}/payment/cancel?orderId=${order.id}`,
      buyerName: order.receiver_name,
      buyerPhone: order.receiver_phone,
      buyerAddress: order.shipping_address,
      expiredAt: Math.floor(Date.now() / 1000) + 15 * 60, // 15 phút
      items: [
        {
          name: `Đơn hàng #${order.id}`,
          quantity: 1,
          price: Math.round(Number(order.final_amount)),
        },
      ],
    });

    return {
      checkoutUrl: link.checkoutUrl,
      qrCode: link.qrCode,
      paymentLinkId: link.paymentLinkId,
      orderCode: link.orderCode,
      amount: link.amount,
      expiresAt: link.expiredAt,
    };
  }

  // ============ WALLET TOPUP ============

  async createWalletTopupLink(amount: number, userId: number) {
    if (amount < 10000) {
      throw new BadRequestException('Số tiền nạp tối thiểu 10.000đ');
    }
    if (amount > 50000000) {
      throw new BadRequestException('Số tiền nạp tối đa 50.000.000đ');
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const frontendUrl = siteUrlChinh(
      this.configService.get<string>('SITE_URL'),
    );

    // orderCode lấy từ id của dòng payment, cùng dãy với link đơn hàng: hai
    // loại không thể trùng nhau, và không lặp theo đồng hồ như công thức cũ
    // (xem PAYOS_MA_GOC).
    const payment = await this.paymentRepository.save(
      this.paymentRepository.create({
        user: { id: userId },
        amount,
        payment_method: PaymentMethod.PAYOS,
        status: PaymentStatus.PENDING,
        type: PaymentType.WALLET_TOPUP,
      }),
    );

    const link = await this.taoLinkHoacDanhDauHong(payment, {
      orderCode: PAYOS_MA_GOC + payment.id,
      amount: Math.round(amount),
      description: `NAP${userId}`.slice(0, 9),
      returnUrl: `${frontendUrl}/payment/return?topup=1`,
      cancelUrl: `${frontendUrl}/payment/cancel?topup=1`,
      buyerName: user.full_name,
      buyerEmail: user.email,
      expiredAt: Math.floor(Date.now() / 1000) + 15 * 60,
    });

    return {
      checkoutUrl: link.checkoutUrl,
      qrCode: link.qrCode,
      paymentLinkId: link.paymentLinkId,
      orderCode: link.orderCode,
      amount: link.amount,
      expiresAt: link.expiredAt,
    };
  }

  /**
   * Gọi PayOS tạo link cho một dòng payment ĐÃ LƯU, rồi ghi thông tin link
   * vào chính dòng đó. PayOS từ chối (mạng, khoá sai, trùng mã) thì dòng
   * chuyển `failed` kèm lý do, không để lại payment `pending` không có link.
   */
  private async taoLinkHoacDanhDauHong(
    payment: Payment,
    yeuCau: Parameters<PayOS['paymentRequests']['create']>[0],
  ) {
    let link: Awaited<ReturnType<PayOS['paymentRequests']['create']>>;
    try {
      link = await this.payos.paymentRequests.create(yeuCau);
    } catch (err) {
      await this.paymentRepository.update(payment.id, {
        status: PaymentStatus.FAILED,
        note: `Tạo link PayOS hỏng: ${(err as Error).message}`,
      });
      throw err;
    }
    await this.paymentRepository.update(payment.id, {
      payos_order_code: String(link.orderCode),
      payos_payment_link_id: link.paymentLinkId,
      payos_checkout_url: link.checkoutUrl,
      payos_qr_code: link.qrCode,
      transaction_code: link.paymentLinkId,
    });
    return link;
  }

  // ============ QUERY ============

  /**
   * `user` để KIỂM QUYỀN (IDOR). Bản trước chỉ có JwtAuthGuard nên ai đăng
   * nhập cũng hỏi được đơn của người khác đã trả tiền chưa, trả lúc nào, và
   * payos_order_code; id đơn tăng dần nên quét được cả bảng. Người lạ nhận 404
   * như đơn không tồn tại, không phải 403 xác nhận là đơn có thật.
   */
  async getOrderStatus(orderId: number, user: IUser) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['user'],
    });
    const laAdmin = user.role === UserRole.ADMIN;
    if (!order || (!laAdmin && order.user?.id !== user.id)) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    // Một đơn nay có thể có nhiều link (mỗi lần tạo một orderCode). Lấy dòng
    // MỚI NHẤT; `id` để phân xử khi hai dòng cùng giây (`created_at` chỉ tới
    // giây), nếu không MySQL trả dòng nào cũng được.
    const payment = await this.paymentRepository.findOne({
      where: { order: { id: orderId }, payment_method: PaymentMethod.PAYOS },
      order: { created_at: 'DESC', id: 'DESC' },
    });
    return {
      orderId: order.id,
      is_paid: order.is_paid,
      paid_at: order.paid_at,
      status: order.status,
      paymentStatus: payment?.status,
      payos_order_code: payment?.payos_order_code,
    };
  }

  /**
   * Mọi thứ màn thanh toán cần, tra bằng mã đơn PayOS.
   *
   * MỘT endpoint cho CẢ HAI luồng — trả tiền đơn hàng và nạp ví — vì chúng
   * khác nhau đúng ở chỗ có `orderId` hay không. Tách làm hai sẽ phải nhân đôi
   * cả màn hình lẫn vòng dò trạng thái.
   *
   * TRẢ VỀ CẢ qrCode: nếu chỉ trả trạng thái thì màn thanh toán không sống nổi
   * qua một lần tải lại trang — mà tải lại là chuyện thường: người ta chuyển
   * khoản xong quay về, hoặc mở link trên máy khác để quét bằng điện thoại.
   *
   * `userId` để KIỂM QUYỀN. Bản trước chỉ chặn bằng JwtAuthGuard, tức bất kỳ ai
   * đã đăng nhập cũng tra được mã của người khác — mà mã đơn PayOS là số tăng
   * dần, đoán được.
   */
  async getPaymentLinkStatus(payosOrderCode: string, userId: number) {
    const payment = await this.paymentRepository.findOne({
      where: { payos_order_code: payosOrderCode },
      relations: ['user', 'order'],
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy payment');
    }
    if (payment.user?.id !== userId) {
      // Cùng thông báo với "không tìm thấy": nói "bạn không có quyền" là xác
      // nhận mã đó có thật, biến chỗ này thành công cụ dò mã.
      throw new NotFoundException('Không tìm thấy payment');
    }

    let payosStatus: string | null = null;
    let expiresAt: number | null = null;
    try {
      const link = await this.payos.paymentRequests.get(Number(payosOrderCode));
      payosStatus = link.status;
      // Hạn hết hiệu lực lấy SỐNG từ PayOS chứ không lưu cột riêng: nó do PayOS
      // quyết, lưu lại là tự tạo thêm một nguồn sự thật thứ hai để lệch.
      expiresAt = (link as any).expiredAt ?? null;
    } catch (err: any) {
      // PayOS lỗi thì vẫn trả dữ liệu đã lưu — mã QR trong DB vẫn quét được.
      this.logger.warn(`Cannot fetch payos status: ${err.message}`);
    }

    return {
      paymentStatus: payment.status,
      paid_at: payment.paid_at,
      type: payment.type,
      payosStatus,
      // Phần để VẼ màn thanh toán:
      orderCode: payment.payos_order_code,
      orderId: payment.order?.id ?? null,
      amount: Number(payment.amount),
      qrCode: payment.payos_qr_code,
      checkoutUrl: payment.payos_checkout_url,
      expiresAt,
    };
  }
  async refreshOrderStatus(orderId: number, userId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['user'],
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    if (order.user.id !== userId) {
      throw new BadRequestException('Bạn không có quyền truy cập đơn hàng này');
    }

    // Tìm payment PayOS MỚI NHẤT của đơn (cùng lý do với getOrderStatus).
    const payment = await this.paymentRepository.findOne({
      where: { order: { id: orderId }, payment_method: PaymentMethod.PAYOS },
      order: { created_at: 'DESC', id: 'DESC' },
    });
    if (!payment?.payos_order_code) {
      throw new NotFoundException(
        'Không tìm thấy payment PayOS cho đơn hàng này',
      );
    }

    // Gọi PayOS API để lấy status thật
    let link: PaymentLink;
    try {
      link = await this.payos.paymentRequests.get(
        Number(payment.payos_order_code),
      );
    } catch (e: any) {
      this.logger.warn(
        `PayOS API error for orderCode=${payment.payos_order_code}: ${e.message}`,
      );
      throw new BadRequestException(
        'Không kiểm tra được trạng thái từ PayOS: ' + e.message,
      );
    }

    // Cùng luật với webhook: PayOS báo số khác số payment cần thì KHÔNG ghi
    // sổ. Thiếu chặn này thì webhook lệch tiền bị từ chối xong, người mua bấm
    // "kiểm tra lại" là đơn vẫn thành đã trả đủ (đo bằng
    // `webhook-so-tien-va-ma-la.spec.ts`).
    const soTienPayos = Number(link.amountPaid ?? link.amount);
    if (
      link.status === 'PAID' &&
      payment.status !== PaymentStatus.SUCCESS &&
      !this.soTienKhop(payment, soTienPayos)
    ) {
      // Đã đánh dấu từ trước (không còn pending) thì không đánh dấu, không
      // báo lại: mỗi lần người mua bấm "kiểm tra lại" từng nối thêm một ghi
      // chú và báo mọi admin thêm một lần (review 26/10).
      const lech =
        payment.status === PaymentStatus.PENDING
          ? await this.dataSource.transaction((em) =>
              this.danhDauLechTien(em, payment, soTienPayos, 'refresh'),
            )
          : null;
      if (lech) await this.baoLechTien(lech);
      return {
        orderId: order.id,
        is_paid: order.is_paid,
        payos_status: link.status,
        payment_status: PaymentStatus.FAILED,
        amount: link.amount,
      };
    }

    // PayOS báo đã trả tiền mà database chưa biết → ghi nhận.
    //
    // Đi qua đúng hàm mà webhook dùng, với KHOÁ CHỐNG TRÙNG GIỐNG HỆT. Nhờ
    // vậy webhook và đường này không thể cộng tiền hai lần cho cùng một lần
    // trả, dù chúng chạy cách nhau vài giây hay cùng lúc.
    if (link.status === 'PAID' && payment.status !== PaymentStatus.SUCCESS) {
      this.logger.log(
        `PayOS báo PAID nhưng database chưa ghi nhận, xử lý payment ${payment.id}`,
      );

      const outcome = await this.dataSource.transaction(async (em) => {
        const fresh = await em.findOne(Payment, {
          where: { id: payment.id },
          relations: ['order', 'user'],
        });
        if (!fresh || fresh.status === PaymentStatus.SUCCESS) return null;

        return this.applyPaidPayment(em, fresh, {
          idempotencyKey: `payos:${payment.payos_order_code}:${payment.payos_payment_link_id}`,
          transactionCode: String(link.id),
          metadata: { source: 'refreshOrderStatus' },
        });
      });

      if (outcome) await this.notifyPaid(outcome);
    }

    return {
      orderId: order.id,
      is_paid: order.is_paid || link.status === 'PAID',
      payos_status: link.status,
      payment_status:
        link.status === 'PAID' ? PaymentStatus.SUCCESS : payment.status,
      amount: link.amount,
    };
  }

  // ============ CANCEL ============

  async cancelPaymentLink(payosOrderCode: string, userId: number) {
    const payment = await this.paymentRepository.findOne({
      where: { payos_order_code: payosOrderCode, user: { id: userId } },
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy payment');
    }
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        'Chỉ có thể hủy payment đang chờ thanh toán',
      );
    }
    await this.payos.paymentRequests.cancel(
      Number(payosOrderCode),
      'User cancelled',
    );
    payment.status = PaymentStatus.FAILED;
    await this.paymentRepository.save(payment);
    return { cancelled: true, payos_order_code: payosOrderCode };
  }

  /**
   * Huỷ link thanh toán còn treo của một đơn, nếu có.
   *
   * Khác `cancelPaymentLink` ở chỗ KHÔNG hỏi ai đang huỷ: người bán cũng huỷ
   * được đơn, mà link thì luôn đứng tên người mua. Tra theo đơn thay vì theo
   * người.
   *
   * CỐ GẮNG HẾT SỨC, không ném lỗi. Lúc hàm này được gọi thì đơn đã huỷ xong
   * và transaction đã commit — để một lỗi mạng của PayOS làm hỏng lời gọi huỷ
   * đơn là vô lý. Nếu huỷ link thất bại thì link vẫn sống, nhưng lưới an toàn
   * thứ hai vẫn chặn: `applyPaidPayment` thấy đơn đã huỷ sẽ ghi tiền vào ví
   * người mua thay vì hồi sinh đơn.
   */
  async voidOpenLinkForOrder(orderId: number): Promise<boolean> {
    // MỌI link pending, không chỉ một (review 26/10). Từ khi orderCode theo
    // từng lần tạo link (PAYOS_MA_GOC), một đơn có thể có nhiều link cùng
    // sống; `findOne` cũ đóng một cái và để cái kia nhận tiền cho đơn đã huỷ.
    const dangMo = await this.paymentRepository.find({
      where: {
        order: { id: orderId },
        type: PaymentType.ORDER_PAYMENT,
        status: PaymentStatus.PENDING,
      },
    });

    let daDong = false;
    for (const payment of dangMo) {
      if (!payment.payos_order_code) continue;
      try {
        await this.payos.paymentRequests.cancel(
          Number(payment.payos_order_code),
          'Order cancelled',
        );
        // Chỉ hạ dòng còn pending: webhook thành công có thể vừa commit.
        await this.paymentRepository.update(
          { id: payment.id, status: PaymentStatus.PENDING },
          { status: PaymentStatus.FAILED },
        );
        daDong = true;
      } catch (err) {
        this.logger.warn(
          `Không huỷ được link PayOS ${payment.payos_order_code} của đơn #${orderId}: ` +
            `${(err as Error).message}. Link còn sống, nhưng trả tiền vào đó sẽ ` +
            'rơi vào ví người mua chứ không hồi sinh đơn.',
        );
      }
    }
    return daDong;
  }

  // ============ WEBHOOK ============

  /**
   * Xử lý webhook PayOS báo kết quả thanh toán.
   *
   * TOÀN BỘ việc ghi nằm trong MỘT transaction. Bản cũ gọi `save()` năm lần
   * rời rạc, và tệ nhất là nó ghi dấu chống trùng vào `payos_webhook_log`
   * TRƯỚC rồi mới cộng tiền. Sập giữa hai bước đó thì lần PayOS gửi lại sẽ bị
   * coi là trùng và bỏ qua — khách mất tiền, ví không có gì, không cảnh báo
   * nào nổ ra vì cả hai bên đều tưởng đã xong.
   *
   * Giờ dấu chống trùng là `ledger_transactions.idempotency_key`, được INSERT
   * trong cùng transaction với các bút toán. Hai việc chung một số phận: hoặc
   * cùng có, hoặc cùng không. Gửi lại bao nhiêu lần cũng chỉ vào tiền một lần.
   *
   * Thông báo cho người dùng nằm NGOÀI transaction, chạy sau khi commit —
   * gửi thông báo hỏng thì không được phép làm rollback tiền.
   */
  async handleWebhook(rawBody: any) {
    // Đóng trước khi chạm SDK: không có khoá thì không có cách nào phân biệt
    // webhook thật với webhook giả (xem webhookKhongCoKhoa).
    if (this.webhookKhongCoKhoa) {
      this.logger.warn(
        'Từ chối webhook PayOS: chưa cấu hình PAYOS_CHECKSUM_KEY',
      );
      return { success: false, message: 'Invalid signature' };
    }
    let webhookData: WebhookData;
    try {
      webhookData = await this.payos.webhooks.verify(rawBody);
    } catch (err: any) {
      this.logger.warn(`Chữ ký webhook không hợp lệ: ${err.message}`);
      return { success: false, message: 'Invalid signature' };
    }

    const orderCode = String(webhookData.orderCode);
    const paymentLinkId = String(webhookData.paymentLinkId);
    const isSuccess = webhookData.code === '00' && rawBody.success === true;

    const outcome = await this.dataSource.transaction(async (em) => {
      // KHOÁ DÒNG PAYMENT TRƯỚC KHI ĐỌC NÓ.
      //
      // PayOS gửi trùng cùng một webhook, cùng lúc: bản cũ đọc payment không
      // khoá, nên lượt sau thấy `pending`, chờ khoá dòng đơn trong
      // `applyPaidPayment`, rồi ghi bút toán với đúng khoá chống trùng của lượt
      // trước và nổ 1062 thay vì trả "Already paid" (bài kiểm "review 8": 4/5
      // lượt lỗi). Có khoá thì lượt sau đứng chờ ở đây, và lần đọc có khoá trả
      // bản mới nhất: `success`.
      //
      // Khoá riêng bảng payments, không JOIN (cùng bẫy với
      // `EscrowsService.napVaKhoa`: FOR UPDATE khoá lây mọi dòng bị JOIN).
      // Thứ tự khoá vẫn hợp lệ: payment, rồi đơn, rồi ký quỹ, rồi sổ cái.
      const daKhoa = await em
        .createQueryBuilder(Payment, 'p')
        .setLock('pessimistic_write')
        .where('p.payos_order_code = :orderCode', { orderCode })
        .getOne();
      const payment = daKhoa
        ? await em.findOne(Payment, {
            where: { id: daKhoa.id },
            relations: ['order', 'user'],
          })
        : null;
      if (payment && daKhoa) payment.status = daKhoa.status;

      if (!payment) {
        return {
          processed: false as const,
          reason: 'Payment not found' as const,
        };
      }

      if (!isSuccess) {
        // CHỈ HẠ PAYMENT CÒN PENDING. Webhook "không thành công" có thể tới SAU
        // webhook thành công (PayOS gửi lại, tới sai thứ tự). Bản cũ ghi đè
        // thẳng FAILED lên payment SUCCESS: tiền vẫn nằm trong sổ, còn chứng từ
        // nói là chưa trả (bài kiểm C cuối trong `tien-ve-tre.spec.ts`).
        // Điều kiện nằm trong WHERE nên một lần thành công commit chen giữa
        // cũng không bị hạ.
        await em.update(
          Payment,
          { id: payment.id, status: PaymentStatus.PENDING },
          { status: PaymentStatus.FAILED },
        );
        return {
          processed: false as const,
          reason: 'Payment not successful' as const,
        };
      }

      if (payment.status === PaymentStatus.SUCCESS) {
        return { processed: false as const, reason: 'Already paid' as const };
      }

      // SỐ TIỀN PHẢI KHỚP TỚI TỪNG ĐỒNG.
      //
      // Chữ ký chỉ chứng minh webhook là của PayOS, không chứng minh người mua
      // chuyển đủ. `applyPaidPayment` ghi sổ theo `payment.amount` chứ không
      // theo số PayOS báo, nên trước 26/10 chuyển thiếu 100.000 (sửa số tiền
      // trên app ngân hàng khi quét QR tĩnh, hoặc link bị tạo lại với số khác)
      // thì đơn vẫn thành "đã trả đủ" và ký quỹ giữ hộ một khoản không có thật.
      // Lệch thì không ghi gì vào sổ: đánh dấu payment chờ đối soát, log error,
      // báo admin. Trả 2xx: PayOS gửi lại cũng chỉ lệch y như vậy.
      const soTienPayos = Number(webhookData.amount);
      if (!this.soTienKhop(payment, soTienPayos)) {
        const lech = await this.danhDauLechTien(
          em,
          payment,
          soTienPayos,
          'webhook',
        );
        return {
          processed: false as const,
          reason: 'Amount mismatch' as const,
          lech,
        };
      }

      return this.applyPaidPayment(em, payment, {
        // Khoá tất định, dựng từ dữ liệu của PayOS chứ không random. Cùng một
        // lần trả tiền thì mọi lần gửi lại đều sinh ra đúng khoá này.
        idempotencyKey: `payos:${orderCode}:${paymentLinkId}`,
        transactionCode: webhookData.reference || paymentLinkId,
        metadata: { orderCode, paymentLinkId },
      });
    });

    if (!outcome.processed) {
      if (outcome.reason === 'Amount mismatch' && outcome.lech) {
        await this.baoLechTien(outcome.lech);
      }
      if (outcome.reason === 'Payment not found') {
        if (isSuccess) {
          await this.baoMaLa(orderCode, paymentLinkId, webhookData);
        } else {
          this.logger.warn(`Không tìm thấy payment cho orderCode=${orderCode}`);
        }
      }
      return { success: true, processed: false, reason: outcome.reason };
    }

    await this.notifyPaid(outcome);

    this.logger.log(
      `Đã xử lý thanh toán: orderCode=${orderCode} type=${outcome.type}`,
    );
    return { success: true, processed: true };
  }

  /**
   * Ghi nhận một khoản đã trả tiền: bút toán sổ cái, cập nhật đơn, tạo ký quỹ.
   *
   * Dùng chung cho HAI đường vào: webhook PayOS gọi tới, và `refreshOrderStatus`
   * khi client tự hỏi lại trạng thái. Trước đây hai đường này là hai bản sao
   * của cùng một đoạn logic, nên đường thứ hai vẫn giữ nguyên lỗi cộng thẳng
   * `wallet.balance` và không có khoá chống trùng — trả tiền rồi bấm "kiểm tra
   * lại" là cộng tiền lần nữa.
   *
   * Khoá chống trùng giống nhau ở cả hai đường, nên đường nào chạy trước cũng
   * được, đường sau sẽ thấy giao dịch đã có và không làm gì thêm.
   *
   * Phải chạy BÊN TRONG transaction của người gọi.
   */
  private async applyPaidPayment(
    em: EntityManager,
    payment: Payment,
    opts: {
      idempotencyKey: string;
      transactionCode: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const amount = BigInt(Math.round(Number(payment.amount)));
    const gateway = await this.ledgerService.getOrCreateAccount(
      LedgerOwnerType.EXTERNAL,
      null,
      LedgerPurpose.GATEWAY_CLEARING,
      em,
    );

    if (payment.type === PaymentType.WALLET_TOPUP) {
      // Tiền từ cổng thanh toán vào thẳng ví người dùng
      const wallet = await this.ledgerService.getOrCreateAccount(
        LedgerOwnerType.USER,
        payment.user.id,
        LedgerPurpose.AVAILABLE,
        em,
      );
      await this.ledgerService.post(
        {
          idempotencyKey: opts.idempotencyKey,
          type: LedgerTxType.TOPUP,
          reference: { type: 'payment', id: payment.id },
          metadata: opts.metadata,
          entries: [
            { accountId: Number(gateway.id), amount: -amount },
            { accountId: Number(wallet.id), amount },
          ],
        },
        em,
      );
    } else if (payment.type === PaymentType.ORDER_PAYMENT && payment.order) {
      // KHOÁ DÒNG ĐƠN, ĐỌC LẠI, RỒI MỚI QUYẾT TIỀN ĐI ĐÂU.
      //
      // `payment.order` là bản đọc KHÔNG khoá từ đầu webhook. Từ lúc phát link
      // tới lúc tiền về có thể là mười lăm phút, và đơn đã khác đi: đã trả bằng
      // ví (két nhận thêm một ORDER_HOLD không khoản ký quỹ nào trỏ tới, kẹt
      // mãi), đã đi giao (bị kéo ngược về `confirmed`), hoặc vừa bị huỷ đúng
      // lúc webhook chạy (lưới `paidAfterCancel` nhìn bản cũ vẫn thấy
      // `pending`). Đo bằng `tien-ve-tre.spec.ts`.
      //
      // Phải là lần đọc CÓ khoá: trong REPEATABLE READ một lần đọc thường ở
      // đây trả lại đúng ảnh chụp cũ mà webhook đã đọc. Khoá đơn trước mọi bút
      // toán, cùng thứ tự với `applyCancellation` (đơn rồi mới tới sổ cái).
      const don = await em.findOne(Order, {
        where: { id: payment.order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!don) throw new NotFoundException('Không tìm thấy đơn hàng');

      const conNhanTien =
        !don.is_paid && !KHONG_NHAN_TIEN_DON.includes(don.status);

      if (!conNhanTien) {
        // ĐƠN ĐÃ HUỶ MÀ TIỀN VẪN VỀ.
        //
        // Xảy ra được vì huỷ đơn không huỷ link thanh toán: người mua huỷ đơn
        // chưa trả tiền, rồi mở lại link cũ và trả. Trước đây nhánh dưới đặt
        // thẳng `status = CONFIRMED` mà không nhìn trạng thái hiện tại, nên đơn
        // đã huỷ SỐNG LẠI thành đã xác nhận, trong khi hàng đã trả về kho, tức
        // là bán một món không còn giữ chỗ.
        //
        // Nhưng cũng không được lờ số tiền đi: nó đã nằm trong tài khoản ngân
        // hàng thật rồi. Không ghi sổ thì `gateway_clearing` lệch với ngân hàng,
        // đúng thứ mà cả kiến trúc sổ cái sinh ra để không bao giờ xảy ra.
        //
        // Nên: ghi tiền vào ví người mua, và để đơn nguyên trạng thái huỷ.
        // Người mua có tiền để tiêu tiếp hoặc rút; sổ sách khớp ngân hàng.
        //
        // Cùng một lối ra cho mọi trường hợp đơn không còn nhận tiền được nữa:
        // đã huỷ, đã hoàn tiền, đã giao xong, hoặc đã được trả bằng đường khác.
        const wallet = await this.ledgerService.getOrCreateAccount(
          LedgerOwnerType.USER,
          payment.user.id,
          LedgerPurpose.AVAILABLE,
          em,
        );
        await this.ledgerService.post(
          {
            idempotencyKey: opts.idempotencyKey,
            type: LedgerTxType.TOPUP,
            reference: { type: 'order', id: don.id },
            metadata: {
              ...opts.metadata,
              paidAfterCancel: don.status === OrderStatus.CANCELLED,
              orderStatus: don.status,
              daTraTruoc: don.is_paid,
              paymentId: payment.id,
            },
            entries: [
              { accountId: Number(gateway.id), amount: -amount },
              { accountId: Number(wallet.id), amount },
            ],
          },
          em,
        );
        this.logger.warn(
          `Đơn #${don.id} (${don.status}, is_paid=${don.is_paid}) không còn ` +
            `nhận tiền được nhưng tiền vẫn về. Ghi ${amount} vào ví người mua ` +
            `#${payment.user.id} thay vì ký quỹ; đơn giữ nguyên.`,
        );
      } else {
        // Chỉ đúng hai cột tiền, và chỉ đi `pending -> confirmed`. Đơn COD
        // đang giao mà người mua chuyển khoản thì vẫn là đang giao.
        await em.update(
          Order,
          { id: don.id },
          {
            is_paid: true,
            paid_at: new Date(),
            ...(don.status === OrderStatus.PENDING
              ? { status: OrderStatus.CONFIRMED }
              : {}),
          },
        );

        // Tách thành từng khoản theo người bán, trong CÙNG transaction.
        // Bản cũ không hề gọi bước này, nên đơn trả qua PayOS chưa bao giờ
        // sinh ra bản ghi ký quỹ nào.
        await this.escrowsService.createOrderEscrows(don.id, em);

        // CHÈN KÝ QUỸ TRƯỚC, GHI SỔ SAU (tiền PayOS về).
        //
        // Thứ tự khoá chung của mọi đường tiền là đơn, rồi ký quỹ, rồi sổ cái:
        // huỷ đơn và giải ngân khoá ký quỹ rồi mới ghi sổ. Đường này từng làm
        // ngược lại (khoá két giữ hộ trong `ledger.post` rồi mới chèn ký quỹ),
        // tức là hai giao dịch đi hai chiều trên cùng hai tài nguyên: công thức
        // của deadlock 1213 (review 3). Cùng transaction nên ghi sổ hỏng thì ký
        // quỹ vừa chèn cũng quay lui theo.
        //
        // Tiền từ cổng thanh toán vào thẳng ô giữ hộ, KHÔNG đi qua ví người
        // mua: người mua chưa bao giờ cầm số tiền này.
        const hold = await this.ledgerService.getOrCreateAccount(
          LedgerOwnerType.PLATFORM,
          null,
          LedgerPurpose.ESCROW_HOLD,
          em,
        );
        await this.ledgerService.post(
          {
            idempotencyKey: opts.idempotencyKey,
            type: LedgerTxType.ORDER_HOLD,
            reference: { type: 'order', id: don.id },
            metadata: { ...opts.metadata, paymentId: payment.id },
            entries: [
              { accountId: Number(gateway.id), amount: -amount },
              { accountId: Number(hold.id), amount },
            ],
          },
          em,
        );
      }
    } else {
      throw new BadRequestException(
        `Payment #${payment.id} có type=${payment.type} nhưng thiếu dữ liệu đi kèm`,
      );
    }

    payment.status = PaymentStatus.SUCCESS;
    payment.paid_at = new Date();
    payment.transaction_code = opts.transactionCode;
    await em.save(Payment, payment);

    return {
      processed: true as const,
      paymentId: payment.id,
      userId: payment.user?.id,
      orderId: payment.order?.id,
      type: payment.type,
      amount: Number(payment.amount),
    };
  }

  /** Số PayOS báo có khớp số payment cần thu không, so theo đồng (làm tròn). */
  private soTienKhop(payment: Payment, soTienPayos: number): boolean {
    return (
      Number.isFinite(soTienPayos) &&
      Math.round(soTienPayos) === Math.round(Number(payment.amount))
    );
  }

  /**
   * Đánh dấu payment CHỜ ĐỐI SOÁT TAY, trong transaction của người gọi.
   *
   * Không thêm trạng thái mới (đổi enum là thêm migration): dùng `failed` cho
   * "chưa được ghi nhận là đã trả" và cột `note` có sẵn với tiền tố
   * `[CAN_DOI_SOAT]` để admin lọc ra được. `failed` chứ không để `pending`:
   * `pending` là thứ `voidOpenLinkForOrder` sẽ đi huỷ link rồi ghi đè, còn ở
   * đây tiền đã về một phần và cần người xem. Gửi lại webhook lệch vẫn đi qua
   * phép so số tiền trước `applyPaidPayment`, nên `failed` không mở đường
   * ghi sổ nào.
   */
  private async danhDauLechTien(
    em: EntityManager,
    payment: Payment,
    soTienPayos: number,
    nguon: 'webhook' | 'refresh',
  ): Promise<{
    paymentId: number;
    orderId?: number;
    canThu: number;
    payosBao: number;
    orderCode: string;
    nguon: string;
  } | null> {
    const canThu = Number(payment.amount);
    const ghiChu =
      `[CAN_DOI_SOAT] ${new Date().toISOString()} ${nguon}: PayOS báo ` +
      `${soTienPayos}, payment cần ${canThu} (orderCode=${payment.payos_order_code}). ` +
      'Chưa ghi sổ, cần đối soát tay với sao kê.';
    // CHỈ ĐÁNH DẤU MỘT LẦN: điều kiện `status = pending` nằm trong WHERE.
    // PayOS gửi lại webhook lệch, hay người mua bấm "kiểm tra lại", thì dòng đã
    // `failed` không bị nối thêm ghi chú và không ai bị báo lại (review 26/10:
    // 2 webhook + 2 lần kiểm tra lại từng ra 4 ghi chú, 4 lần báo admin).
    const kq = await em.update(
      Payment,
      { id: payment.id, status: PaymentStatus.PENDING },
      {
        status: PaymentStatus.FAILED,
        note: payment.note ? `${payment.note}\n${ghiChu}` : ghiChu,
      },
    );
    if (kq.affected !== 1) return null;
    return {
      paymentId: payment.id,
      orderId: payment.order?.id,
      canThu,
      payosBao: soTienPayos,
      orderCode: payment.payos_order_code,
      nguon,
    };
  }

  /** Sau commit: log error và báo admin về một payment lệch tiền. */
  private async baoLechTien(l: {
    paymentId: number;
    orderId?: number;
    canThu: number;
    payosBao: number;
    orderCode: string;
    nguon: string;
  }): Promise<void> {
    this.logger.error(
      `PayOS báo ${l.payosBao} nhưng payment #${l.paymentId} (orderCode=` +
        `${l.orderCode}, đơn #${l.orderId ?? '-'}) cần ${l.canThu}. KHÔNG ghi ` +
        `sổ; payment đánh dấu [CAN_DOI_SOAT] (nguồn: ${l.nguon}).`,
    );
    await this.baoAdmin(
      'PayOS: số tiền lệch, cần đối soát',
      `Payment #${l.paymentId} (orderCode ${l.orderCode}) cần ${l.canThu}đ ` +
        `nhưng PayOS báo ${l.payosBao}đ. Chưa ghi sổ.`,
      { paymentId: l.paymentId, orderId: l.orderId, orderCode: l.orderCode },
    );
  }

  /**
   * Webhook THÀNH CÔNG, chữ ký đúng, mà không có payment nào mang orderCode
   * đó: tiền thật đã vào tài khoản PayOS mà hệ thống không biết của ai.
   *
   * VÌ SAO VẪN TRẢ 2xx thay vì lỗi để PayOS gửi lại. Gửi lại không làm dòng
   * payment hiện ra: dòng được lưu TRƯỚC khi link tới tay người mua
   * (`createOrderPaymentLink` lưu rồi mới trả checkoutUrl), nên mã lạ hôm nay
   * vẫn lạ ở lần gửi thứ mười. Và bước "xác nhận webhook URL" của PayOS gửi
   * một webhook thử đã ký với orderCode 123: trả lỗi cho mã lạ là không đăng
   * ký nổi webhook. Thay vào đó: log error và GHI LẠI cho admin (thông báo
   * hệ thống lưu trong bảng notifications), không im lặng như bản cũ.
   */
  private async baoMaLa(
    orderCode: string,
    paymentLinkId: string,
    webhookData: { amount?: unknown; reference?: unknown },
  ): Promise<void> {
    this.logger.error(
      `Webhook PayOS THÀNH CÔNG cho orderCode=${orderCode} ` +
        `(paymentLinkId=${paymentLinkId}, amount=${String(webhookData.amount)}, ` +
        `reference=${String(webhookData.reference)}) nhưng không có payment ` +
        'nào khớp. Tiền đã vào tài khoản PayOS, cần đối soát tay.',
    );
    await this.baoAdmin(
      'PayOS: tiền về cho mã không có trong hệ thống',
      `orderCode ${orderCode}, ${String(webhookData.amount)}đ, mã giao dịch ` +
        `${String(webhookData.reference)}. Không có payment nào khớp.`,
      { orderCode, paymentLinkId, amount: webhookData.amount },
    );
  }

  /** Thông báo hệ thống cho mọi admin. Hỏng thì chỉ log, không ném. */
  private async baoAdmin(
    title: string,
    content: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const admins = await this.userRepository.find({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });
      for (const a of admins) {
        await this.notificationsService.create({
          user_id: a.id,
          type: NotificationType.SYSTEM,
          title,
          content,
          data,
        });
      }
    } catch (e) {
      this.logger.error(
        `Không báo được admin về "${title}": ${(e as Error).message}`,
      );
    }
  }

  /** Chạy sau commit. Hỏng thì chỉ mất thông báo, tiền đã vào sổ rồi. */
  private async notifyPaid(o: {
    paymentId: number;
    userId?: number;
    orderId?: number;
    type: PaymentType;
    amount: number;
  }): Promise<void> {
    if (!o.userId) return;

    const money = o.amount.toLocaleString('vi-VN');
    const isOrder = o.type === PaymentType.ORDER_PAYMENT;

    try {
      await this.notificationsService.create({
        user_id: o.userId,
        type: NotificationType.PAYMENT,
        title: isOrder ? 'Thanh toán đơn hàng thành công' : 'Nạp ví thành công',
        content: isOrder
          ? `Đơn hàng #${o.orderId} đã được thanh toán ${money}đ qua PayOS.`
          : `Bạn đã nạp ${money}đ vào ví qua PayOS.`,
        data: { orderId: o.orderId, paymentId: o.paymentId },
      });
    } catch (e: any) {
      this.logger.warn(`Không gửi được thông báo: ${e.message}`);
    }
  }
}
