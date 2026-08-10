import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { User } from '@identity/users/entities/user.entity';
import { Repository } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import {
  PaymentStatus,
  PaymentType,
  PaymentMethod,
} from '@common/enums/payment.enum';
import { WalletsService } from '@money/wallets/wallets.service';
import { Wallet } from '@money/wallets/entities/wallet.entity';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly walletsService: WalletsService,
  ) {}

  async create(createPaymentDto: CreatePaymentDto, user: IUser) {
    // payment_method là tuỳ chọn trong DTO nhưng hai hàm bên dưới cần có.
    // Trước đây kiểu TS không optional nên không ai thấy; giờ mặc định về
    // COD cho khớp với mặc định của entity Order.
    const {
      order_id,
      amount,
      payment_method = PaymentMethod.COD,
    } = createPaymentDto;

    if (order_id) {
      return this.processOrderPayment(order_id, payment_method, user);
    }

    if (amount) {
      return this.processWalletTopup(amount, payment_method, user);
    }

    throw new BadRequestException('Vui lòng cung cấp order_id hoặc amount');
  }

  private async processOrderPayment(
    orderId: number,
    paymentMethod: PaymentMethod,
    user: IUser,
  ) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['user'],
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    if (order.user.id !== user.id) {
      throw new ForbiddenException(
        'Bạn không có quyền thanh toán đơn hàng này',
      );
    }
    if (order.is_paid) {
      throw new BadRequestException('Đơn hàng đã được thanh toán');
    }

    const method = paymentMethod || order.payment_method;

    if (method === PaymentMethod.WALLET) {
      // Khoá chống trùng tất định theo đơn: bấm thanh toán hai lần thì chỉ
      // trừ tiền một lần.
      await this.walletsService.deduct(
        user.id,
        Number(order.final_amount),
        `order_${orderId}`,
        undefined,
        `order_pay:${orderId}`,
      );

      await this.orderRepository.update(orderId, {
        is_paid: true,
        paid_at: new Date(),
      });

      const payment = this.paymentRepository.create({
        order: { id: orderId },
        user: { id: user.id },
        amount: Number(order.final_amount),
        payment_method: PaymentMethod.WALLET,
        status: PaymentStatus.SUCCESS,
        type: PaymentType.ORDER_PAYMENT,
        paid_at: new Date(),
      });

      return this.paymentRepository.save(payment);
    }

    const payment = this.paymentRepository.create({
      order: { id: orderId },
      user: { id: user.id },
      amount: Number(order.final_amount),
      payment_method: method,
      status: PaymentStatus.PENDING,
      type: PaymentType.ORDER_PAYMENT,
    });

    return this.paymentRepository.save(payment);
  }

  private async processWalletTopup(
    amount: number,
    paymentMethod: PaymentMethod,
    user: IUser,
  ) {
    const method = paymentMethod || PaymentMethod.WALLET;

    const result = await this.walletsService.topup(user.id, amount);

    const payment = this.paymentRepository.create({
      user: { id: user.id },
      amount,
      payment_method: method,
      status: PaymentStatus.SUCCESS,
      type: PaymentType.WALLET_TOPUP,
      paid_at: new Date(),
    });

    return this.paymentRepository.save(payment);
  }

  async findAll(currentPage: string, limit: string, type: string, user: IUser) {
    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 10;
    const offset = (numPage - 1) * numLimit;

    const where: any = {};
    if (user.role !== 'admin') {
      where.user = { id: user.id };
    }
    if (type) {
      where.type = type;
    }

    const [result, totalItems] = await this.paymentRepository.findAndCount({
      where,
      skip: offset,
      take: numLimit,
      relations: ['order'],
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: Math.ceil(totalItems / numLimit),
        total: totalItems,
      },
      result,
    };
  }

  async findOne(id: number, user: IUser) {
    const where: any = { id };
    if (user.role !== 'admin') {
      where.user = { id: user.id };
    }

    const payment = await this.paymentRepository.findOne({
      where,
      relations: ['order', 'user'],
    });

    if (!payment) {
      throw new NotFoundException('Không tìm thấy giao dịch');
    }

    return payment;
  }

  async update(id: number, updatePaymentDto: UpdatePaymentDto, user: IUser) {
    const payment = await this.findOne(id, user);

    if (updatePaymentDto.status) {
      payment.status = updatePaymentDto.status;
      if (updatePaymentDto.status === PaymentStatus.SUCCESS) {
        payment.paid_at = new Date();
      }
    }
    if (updatePaymentDto.transaction_code) {
      payment.transaction_code = updatePaymentDto.transaction_code;
    }

    await this.paymentRepository.save(payment);

    if (
      payment.status === PaymentStatus.SUCCESS &&
      payment.order &&
      payment.type === PaymentType.ORDER_PAYMENT
    ) {
      await this.orderRepository.update(payment.order.id, {
        is_paid: true,
        paid_at: new Date(),
      });
    }

    return this.findOne(id, user);
  }

  /**
   * Số dư đọc từ sổ cái, không đọc cột `users.balance` nữa.
   *
   * Cột đó từng là nguồn sự thật thứ hai và giờ không còn ai ghi vào, nên
   * đọc nó là đọc một con số đã đứng yên từ lâu.
   */
  async getBalance(user: IUser) {
    return this.walletsService.getBalance(user.id);
  }

  async remove(id: number, user: IUser) {
    const payment = await this.findOne(id, user);
    await this.paymentRepository.delete(id);
    return 'Xóa giao dịch thành công';
  }
}
