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
import { Payment } from '@money/payments/entities/payment.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { Wallet } from '@money/wallets/entities/wallet.entity';
import {
  PaymentStatus,
  PaymentType,
  PaymentMethod,
} from '@common/enums/payment.enum';
import { OrderStatus } from '@ordering/orders/entities/order.entity';
import { User } from '@identity/users/entities/user.entity';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { NotificationType } from '@messaging/notifications/entities/notification.entity';
import { siteUrlChinh } from '@common/site-url';

@Injectable()
export class PayosService {
  private readonly logger = new Logger(PayosService.name);
  private payos: PayOS;

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

    const frontendUrl = siteUrlChinh(
      this.configService.get<string>('SITE_URL'),
    );

    // Tạo payment link qua PayOS
    const link = await this.payos.paymentRequests.create({
      orderCode: order.id,
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

    // Tạo Payment record với status = PENDING
    const payment = this.paymentRepository.create({
      order: { id: order.id },
      user: { id: userId },
      amount: order.final_amount,
      payment_method: PaymentMethod.PAYOS,
      status: PaymentStatus.PENDING,
      type: PaymentType.ORDER_PAYMENT,
      payos_order_code: String(link.orderCode),
      payos_payment_link_id: link.paymentLinkId,
      payos_checkout_url: link.checkoutUrl,
      payos_qr_code: link.qrCode,
      transaction_code: link.paymentLinkId,
    });
    await this.paymentRepository.save(payment);

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
    // orderCode phải unique → dùng timestamp + userId
    const orderCode = Number(`${Date.now().toString().slice(-7)}${userId}`);

    const link = await this.payos.paymentRequests.create({
      orderCode,
      amount: Math.round(amount),
      description: `NAP${userId}`.slice(0, 9),
      returnUrl: `${frontendUrl}/payment/return?topup=1`,
      cancelUrl: `${frontendUrl}/payment/cancel?topup=1`,
      buyerName: user.full_name,
      buyerEmail: user.email,
      expiredAt: Math.floor(Date.now() / 1000) + 15 * 60,
    });

    const payment = this.paymentRepository.create({
      user: { id: userId },
      amount,
      payment_method: PaymentMethod.PAYOS,
      status: PaymentStatus.PENDING,
      type: PaymentType.WALLET_TOPUP,
      payos_order_code: String(link.orderCode),
      payos_payment_link_id: link.paymentLinkId,
      payos_checkout_url: link.checkoutUrl,
      payos_qr_code: link.qrCode,
      transaction_code: link.paymentLinkId,
    });
    await this.paymentRepository.save(payment);

    return {
      checkoutUrl: link.checkoutUrl,
      qrCode: link.qrCode,
      paymentLinkId: link.paymentLinkId,
      orderCode: link.orderCode,
      amount: link.amount,
      expiresAt: link.expiredAt,
    };
  }

  // ============ QUERY ============

  async getOrderStatus(orderId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    const payment = await this.paymentRepository.findOne({
      where: { order: { id: orderId }, payment_method: PaymentMethod.PAYOS },
      order: { created_at: 'DESC' },
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

    // Tìm payment PayOS của đơn
    const payment = await this.paymentRepository.findOne({
      where: { order: { id: orderId }, payment_method: PaymentMethod.PAYOS },
      order: { created_at: 'DESC' },
    });
    if (!payment?.payos_order_code) {
      throw new NotFoundException(
        'Không tìm thấy payment PayOS cho đơn hàng này',
      );
    }

    // Gọi PayOS API để lấy status thật
    let link;
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
    const payment = await this.paymentRepository.findOne({
      where: {
        order: { id: orderId },
        type: PaymentType.ORDER_PAYMENT,
        status: PaymentStatus.PENDING,
      },
    });
    if (!payment?.payos_order_code) return false;

    try {
      await this.payos.paymentRequests.cancel(
        Number(payment.payos_order_code),
        'Order cancelled',
      );
      payment.status = PaymentStatus.FAILED;
      await this.paymentRepository.save(payment);
      return true;
    } catch (err) {
      this.logger.warn(
        `Không huỷ được link PayOS ${payment.payos_order_code} của đơn #${orderId}: ` +
          `${err.message}. Link còn sống, nhưng trả tiền vào đó sẽ rơi vào ví ` +
          'người mua chứ không hồi sinh đơn.',
      );
      return false;
    }
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
    let webhookData;
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
      const payment = await em.findOne(Payment, {
        where: { payos_order_code: orderCode },
        relations: ['order', 'user'],
      });

      if (!payment) {
        this.logger.warn(`Không tìm thấy payment cho orderCode=${orderCode}`);
        return {
          processed: false as const,
          reason: 'Payment not found' as const,
        };
      }

      if (!isSuccess) {
        payment.status = PaymentStatus.FAILED;
        await em.save(Payment, payment);
        return {
          processed: false as const,
          reason: 'Payment not successful' as const,
        };
      }

      if (payment.status === PaymentStatus.SUCCESS) {
        return { processed: false as const, reason: 'Already paid' as const };
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
    } else if (
      payment.type === PaymentType.ORDER_PAYMENT &&
      payment.order &&
      payment.order.status === OrderStatus.CANCELLED
    ) {
      // ĐƠN ĐÃ HUỶ MÀ TIỀN VẪN VỀ.
      //
      // Xảy ra được vì huỷ đơn không huỷ link thanh toán: người mua huỷ đơn
      // chưa trả tiền, rồi mở lại link cũ và trả. Trước đây nhánh dưới đặt
      // thẳng `status = CONFIRMED` mà không nhìn trạng thái hiện tại, nên đơn
      // đã huỷ SỐNG LẠI thành đã xác nhận — trong khi hàng đã trả về kho, tức
      // là bán một món không còn giữ chỗ.
      //
      // Nhưng cũng không được lờ số tiền đi: nó đã nằm trong tài khoản ngân
      // hàng thật rồi. Không ghi sổ thì `gateway_clearing` lệch với ngân hàng,
      // đúng thứ mà cả kiến trúc sổ cái sinh ra để không bao giờ xảy ra.
      //
      // Nên: ghi tiền vào ví người mua, và để đơn nguyên trạng thái huỷ.
      // Người mua có tiền để tiêu tiếp hoặc rút; sổ sách khớp ngân hàng.
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
          reference: { type: 'order', id: payment.order.id },
          metadata: {
            ...opts.metadata,
            paidAfterCancel: true,
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
        `Đơn #${payment.order.id} đã huỷ nhưng tiền vẫn về. Ghi ${amount} vào ví ` +
          `người mua #${payment.user.id} thay vì ký quỹ; đơn giữ nguyên trạng thái huỷ.`,
      );
    } else if (payment.type === PaymentType.ORDER_PAYMENT && payment.order) {
      // Tiền từ cổng thanh toán vào thẳng ô giữ hộ, KHÔNG đi qua ví người
      // mua — người mua chưa bao giờ cầm số tiền này.
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
          reference: { type: 'order', id: payment.order.id },
          metadata: { ...opts.metadata, paymentId: payment.id },
          entries: [
            { accountId: Number(gateway.id), amount: -amount },
            { accountId: Number(hold.id), amount },
          ],
        },
        em,
      );

      payment.order.is_paid = true;
      payment.order.paid_at = new Date();
      payment.order.status = OrderStatus.CONFIRMED;
      await em.save(Order, payment.order);

      // Tách thành từng khoản theo người bán, trong CÙNG transaction.
      // Bản cũ không hề gọi bước này, nên đơn trả qua PayOS chưa bao giờ
      // sinh ra bản ghi ký quỹ nào.
      await this.escrowsService.createOrderEscrows(payment.order.id, em);
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
