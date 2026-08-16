import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayOS } from '@payos/node';
import { Payment } from '../payments/entities/payment.entity';
import { Order } from '../orders/entities/order.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { PayosWebhookLog } from './entities/payos-webhook-log.entity';
import { PaymentStatus, PaymentType, PaymentMethod } from '../common/enums/payment.enum';
import { OrderStatus } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PayosService {
  private readonly logger = new Logger(PayosService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(PayosWebhookLog)
    private readonly webhookLogRepository: Repository<PayosWebhookLog>,
  ) {}

  private async getPayOS(): Promise<PayOS> {
    const clientId = (await this.settingsService.getValue('payos_client_id')) || this.configService.get<string>('PAYOS_CLIENT_ID') || '';
    const apiKey = (await this.settingsService.getValue('payos_api_key')) || this.configService.get<string>('PAYOS_API_KEY') || '';
    const checksumKey = (await this.settingsService.getValue('payos_checksum_key')) || this.configService.get<string>('PAYOS_CHECKSUM_KEY') || '';
    const baseURL = this.configService.get<string>('PAYOS_HOST') || 'https://api-merchant.payos.vn';

    return new PayOS({ clientId, apiKey, checksumKey, baseURL });
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
      throw new BadRequestException('Bạn không có quyền thanh toán đơn hàng này');
    }
    if (order.is_paid) {
      throw new BadRequestException('Đơn hàng đã được thanh toán');
    }

    const frontendUrl = this.configService.get<string>('SITE_URL') || 'http://localhost:3001';
    const payos = await this.getPayOS();

    // Tạo payment link qua PayOS
    const link = await payos.paymentRequests.create({
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

    const frontendUrl = this.configService.get<string>('SITE_URL') || 'http://localhost:3001';
    // orderCode phải unique → dùng timestamp + userId
    const orderCode = Number(`${Date.now().toString().slice(-7)}${userId}`);
    const payos = await this.getPayOS();

    const link = await payos.paymentRequests.create({
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
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
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

  async getPaymentLinkStatus(payosOrderCode: string) {
    const payment = await this.paymentRepository.findOne({
      where: { payos_order_code: payosOrderCode },
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy payment');
    }
    let payosStatus: string | null = null;
    try {
      const payos = await this.getPayOS();
      const link = await payos.paymentRequests.get(Number(payosOrderCode));
      payosStatus = link.status;
    } catch (err: any) {
      this.logger.warn(`Cannot fetch payos status: ${err.message}`);
    }
    return {
      paymentStatus: payment.status,
      paid_at: payment.paid_at,
      type: payment.type,
      payosStatus,
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
      throw new NotFoundException('Không tìm thấy payment PayOS cho đơn hàng này');
    }

    // Gọi PayOS API để lấy status thật
    let link;
    try {
      const payos = await this.getPayOS();
      link = await payos.paymentRequests.get(Number(payment.payos_order_code));
    } catch (e: any) {
      this.logger.warn(`PayOS API error for orderCode=${payment.payos_order_code}: ${e.message}`);
      throw new BadRequestException('Không kiểm tra được trạng thái từ PayOS: ' + e.message);
    }

    // Nếu PayOS báo PAID mà DB chưa update → update
    if (link.status === 'PAID' && payment.status !== PaymentStatus.SUCCESS) {
      this.logger.log(`Manually updating payment ${payment.id} to SUCCESS (PayOS reported PAID)`);
      payment.status = PaymentStatus.SUCCESS;
      payment.paid_at = new Date();
      payment.transaction_code = String(link.id);
      await this.paymentRepository.save(payment);

      if (payment.type === PaymentType.ORDER_PAYMENT && payment.order) {
        payment.order.is_paid = true;
        payment.order.paid_at = new Date();
        payment.order.status = OrderStatus.CONFIRMED;
        await this.orderRepository.save(payment.order);

        // Gửi notification
        try {
          await this.notificationsService.create({
            user_id: payment.user.id,
            type: NotificationType.PAYMENT,
            title: 'Thanh toán đơn hàng thành công',
            content: `Đơn hàng #${payment.order.id} đã được thanh toán ${Number(payment.amount).toLocaleString('vi-VN')}đ qua PayOS.`,
            data: { orderId: payment.order.id, paymentId: payment.id },
          });
        } catch (e) {
          this.logger.warn(`Notification failed: ${e.message}`);
        }
      } else if (payment.type === PaymentType.WALLET_TOPUP && payment.user) {
        const wallet = await this.walletRepository.findOne({
          where: { user: { id: payment.user.id } },
        });
        if (wallet) {
          wallet.balance = Number(wallet.balance) + Number(payment.amount);
          await this.walletRepository.save(wallet);
        } else {
          await this.userRepository.increment(
            { id: payment.user.id },
            'balance',
            Number(payment.amount),
          );
        }
        try {
          await this.notificationsService.create({
            user_id: payment.user.id,
            type: NotificationType.PAYMENT,
            title: 'Nạp ví thành công',
            content: `Bạn đã nạp ${Number(payment.amount).toLocaleString('vi-VN')}đ vào ví qua PayOS.`,
            data: { paymentId: payment.id },
          });
        } catch (e) {
          this.logger.warn(`Notification failed: ${e.message}`);
        }
      }
    }

    return {
      orderId: order.id,
      is_paid: order.is_paid || link.status === 'PAID',
      payos_status: link.status,
      payment_status: link.status === 'PAID' ? PaymentStatus.SUCCESS : payment.status,
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
      throw new BadRequestException('Chỉ có thể hủy payment đang chờ thanh toán');
    }
    const payos = await this.getPayOS();
    await payos.paymentRequests.cancel(Number(payosOrderCode), 'User cancelled');
    payment.status = PaymentStatus.FAILED;
    await this.paymentRepository.save(payment);
    return { cancelled: true, payos_order_code: payosOrderCode };
  }

  // ============ WEBHOOK ============

  async handleWebhook(rawBody: any) {
    // 1. Verify signature
    let webhookData;
    try {
      const payos = await this.getPayOS();
      webhookData = await payos.webhooks.verify(rawBody);
    } catch (err: any) {
      this.logger.warn(`Invalid webhook signature: ${err.message}`);
      return { success: false, message: 'Invalid signature' };
    }

    const orderCode = String(webhookData.orderCode);
    const paymentLinkId = webhookData.paymentLinkId;

    // 2. Idempotency: INSERT IGNORE webhook log
    try {
      const log = this.webhookLogRepository.create({
        transaction_id: `${orderCode}-${paymentLinkId}`,
        body: rawBody,
        processed: webhookData.code === '00' && (rawBody.success === true || webhookData.code === '00'),
      });
      await this.webhookLogRepository.save(log);
    } catch (err: any) {
      // Trùng transaction_id → đã xử lý trước đó
      this.logger.log(`Duplicate webhook ignored: ${orderCode}`);
      return { success: true, duplicate: true };
    }

    // 3. Tìm payment theo payos_order_code
    const payment = await this.paymentRepository.findOne({
      where: { payos_order_code: orderCode },
      relations: ['order', 'user'],
    });
    if (!payment) {
      this.logger.warn(`Payment not found for orderCode=${orderCode}`);
      return { success: true, processed: false, reason: 'Payment not found' };
    }

    // 4. Chỉ xử lý nếu thành công (code = '00' = success)
    if (webhookData.code !== '00' || rawBody.success !== true) {
      this.logger.log(`Payment not successful: code=${webhookData.code} desc=${webhookData.desc}`);
      payment.status = PaymentStatus.FAILED;
      await this.paymentRepository.save(payment);
      return { success: true, processed: false, reason: 'Payment not successful' };
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      return { success: true, processed: false, reason: 'Already paid' };
    }

    // 5. Mark payment as SUCCESS
    payment.status = PaymentStatus.SUCCESS;
    payment.paid_at = new Date();
    payment.transaction_code = webhookData.reference || paymentLinkId;
    await this.paymentRepository.save(payment);

    // 6. Xử lý theo loại payment
    if (payment.type === PaymentType.ORDER_PAYMENT && payment.order) {
      // Update order → paid, tạo escrow
      payment.order.is_paid = true;
      payment.order.paid_at = new Date();
      payment.order.status = OrderStatus.CONFIRMED;
      await this.orderRepository.save(payment.order);

      // Gửi notification cho user
      try {
        await this.notificationsService.create({
          user_id: payment.user.id,
          type: NotificationType.PAYMENT,
          title: 'Thanh toán đơn hàng thành công',
          content: `Đơn hàng #${payment.order.id} đã được thanh toán ${Number(payment.amount).toLocaleString('vi-VN')}đ qua PayOS.`,
          data: { orderId: payment.order.id, paymentId: payment.id },
        });
      } catch (e) {
        this.logger.warn(`Failed to send notification: ${e.message}`);
      }
    } else if (payment.type === PaymentType.WALLET_TOPUP && payment.user) {
      // Cộng tiền vào ví (nếu user có wallet) hoặc user.balance
      const wallet = await this.walletRepository.findOne({
        where: { user: { id: payment.user.id } },
      });
      if (wallet) {
        wallet.balance = Number(wallet.balance) + Number(payment.amount);
        await this.walletRepository.save(wallet);
      } else {
        await this.userRepository.increment(
          { id: payment.user.id },
          'balance',
          Number(payment.amount),
        );
      }
      try {
        await this.notificationsService.create({
          user_id: payment.user.id,
          type: NotificationType.PAYMENT,
          title: 'Nạp ví thành công',
          content: `Bạn đã nạp ${Number(payment.amount).toLocaleString('vi-VN')}đ vào ví qua PayOS.`,
          data: { paymentId: payment.id },
        });
      } catch (e) {
        this.logger.warn(`Failed to send notification: ${e.message}`);
      }
    }

    this.logger.log(`Payment processed successfully: orderCode=${orderCode} type=${payment.type}`);
    return { success: true, processed: true };
  }
}
