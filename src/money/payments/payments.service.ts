import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { normalizePagination } from '@common/dto/pagination.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { User } from '@identity/users/entities/user.entity';
import { DataSource, Repository } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import {
  PaymentStatus,
  PaymentType,
  PaymentMethod,
} from '@common/enums/payment.enum';
import { WalletsService } from '@money/wallets/wallets.service';
import { EscrowsService } from '@money/escrows/escrows.service';
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
    private readonly escrowsService: EscrowsService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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
      return this.refuseSelfServeTopup();
    }

    throw new BadRequestException('Vui lòng cung cấp order_id hoặc amount');
  }

  /**
   * Nạp ví KHÔNG được đi qua đây.
   *
   * Tới 14/08 nhánh này gọi thẳng `walletsService.topup(user.id, amount)`:
   * bất kỳ tài khoản nào đã đăng nhập chỉ cần POST /payments {"amount":
   * 999999999} là ví có thêm gần một tỉ đồng, không ngân hàng nào chuyển,
   * không admin nào duyệt. Tiền đó tiêu được ngay, và rút ra được qua
   * POST /withdrawals — chỉ còn khâu admin duyệt đứng giữa nó và tiền thật,
   * mà admin nhìn vào chỉ thấy một số dư trông bình thường.
   *
   * Đường nạp tiền đúng chỉ có MỘT: tạo link PayOS
   * (POST /payos/create-link {"type":"topup"}), người dùng trả tiền thật, rồi
   * webhook của PayOS mới cộng ví. Ví chỉ được cộng khi tiền đã nằm trong tài
   * khoản ngân hàng — đó là toàn bộ lý do sổ cái có tài khoản
   * `gateway_clearing`.
   *
   * Frontend chưa từng gọi nhánh này (payment.service.ts chỉ dùng getBalance
   * và getAll), nên chặn lại không làm hỏng màn nào.
   */
  private refuseSelfServeTopup(): never {
    throw new BadRequestException(
      'Không nạp ví trực tiếp được. Tạo link thanh toán PayOS ' +
        '(POST /payos/create-link với type = topup) rồi trả tiền; ví được ' +
        'cộng khi PayOS báo về.',
    );
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
      // TRẢ BẰNG VÍ PHẢI LÀM ĐÚNG NHỮNG VIỆC MÀ ĐƯỜNG PayOS LÀM.
      //
      // Bản cũ chỉ làm hai trong bốn: trừ ví, đánh dấu `is_paid`. Nó KHÔNG tách
      // ký quỹ và KHÔNG chuyển đơn sang `confirmed`. Hai thiếu sót đó cộng lại
      // thành một cái bẫy im lặng:
      //
      //   · Không có bản ghi ký quỹ nào  -> `release()` về sau không tìm thấy
      //     gì để giải ngân. Người bán KHÔNG BAO GIỜ nhận được tiền của đơn này.
      //   · Người mua huỷ đơn            -> `applyCancellation` thấy `is_paid`
      //     rồi gọi `refund()`, hàm đó ném `NotFoundException` vì không có khoản
      //     nào, và `orders.service.ts` NUỐT đúng ngoại lệ ấy rồi vẫn huỷ đơn.
      //     Tiền người mua đã rời ví, nằm lại trong `escrow_hold` vĩnh viễn.
      //   · Đơn vẫn `pending`            -> người bán không thấy đơn cần gói.
      //
      // Đo bằng TC-P0-03a/b/c.
      //
      // MỘT TRANSACTION CHO CẢ BỐN VIỆC. Đường PayOS đã làm đúng như vậy
      // (`payos.service.ts` → `applyPaidPayment`): cộng tiền, đổi trạng thái
      // đơn và tạo ký quỹ cùng thành công hoặc cùng huỷ. Ví thì tệ hơn PayOS
      // một bậc nếu nửa vời, vì tiền đã rời ví người mua trước cả khi có đơn
      // nào ghi nhận nó.
      //
      // `status = confirmed` theo quyết định của Đạt 24/09: "Confirmed là trạng
      // thái đã trả, đợi giao hàng" — trả bằng ví hay bằng PayOS thì người mua
      // cũng đã trả xong, không có lý do gì để hai đường khác nhau.
      return this.dataSource.transaction(async (em) => {
        // Khoá chống trùng tất định theo đơn: bấm thanh toán hai lần thì chỉ
        // trừ tiền một lần.
        await this.walletsService.deduct(
          user.id,
          Number(order.final_amount),
          `order_${orderId}`,
          undefined,
          `order_pay:${orderId}`,
          em,
        );

        await em.update(Order, orderId, {
          is_paid: true,
          paid_at: new Date(),
          status: OrderStatus.CONFIRMED,
        });

        // Sau `em.update` ở trên nên `createOrderEscrows` đọc lại sẽ thấy
        // `is_paid = 1` — đúng điều kiện nó đòi.
        await this.escrowsService.createOrderEscrows(orderId, em);

        return em.save(
          Payment,
          em.create(Payment, {
            order: { id: orderId },
            user: { id: user.id },
            amount: Number(order.final_amount),
            payment_method: PaymentMethod.WALLET,
            status: PaymentStatus.SUCCESS,
            type: PaymentType.ORDER_PAYMENT,
            paid_at: new Date(),
          }),
        );
      });
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

  async findAll(currentPage: string, limit: string, type: string, user: IUser) {
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

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

  /**
   * Sửa một bản ghi thanh toán. **CHỈ ADMIN.**
   *
   * Tới 24/09 hàm này không kiểm vai một lần nào. `findOne(id, user)` cho phép
   * CHỦ SỞ HỮU nạp bản ghi — mà chủ sở hữu payment của một đơn chính là người
   * mua. Nên `PATCH /payments/:id {"status":"success"}` trên payment của chính
   * mình là đi thẳng xuống nhánh cuối và ghi `orders.is_paid = 1`.
   *
   * Không một bút toán nào được sinh ra. Đơn "đã thanh toán" mà sổ cái trống,
   * rồi người bán nhìn thấy đơn đã trả tiền và gửi hàng.
   *
   * Đo được bằng TC-P0-01 (`tu-danh-dau-da-tra-tien.spec.ts`): API trả 200 kèm
   * `is_paid: 1` trong khi `COUNT(ledger_transactions) = 0`.
   *
   * Vì sao chặn ở đây chứ không sửa `findOne`: `findOne` đúng như nó là — người
   * mua PHẢI xem được giao dịch của mình. Cái sai là ĐỌC được thì GHI được.
   *
   * Đường đi bình thường của "đơn đã trả tiền" là webhook PayOS
   * (`payos.service.ts` → `applyPaidPayment`), nơi tiền và trạng thái đi chung
   * một transaction. Endpoint này chỉ còn dành cho admin đối soát tay.
   */
  async update(id: number, updatePaymentDto: UpdatePaymentDto, user: IUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException(
        'Chỉ admin mới được sửa giao dịch thanh toán. Trạng thái thanh toán ' +
          'do cổng thanh toán quyết định, không do người dùng khai báo.',
      );
    }

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

  /**
   * Xoá bản ghi thanh toán. **CHỈ ADMIN**, cùng lý do với `update()`.
   *
   * Trước đây người mua xoá cứng được payment của chính mình — tức xoá luôn
   * dấu vết đối soát giữa sổ cái và cổng thanh toán. Một khoản tiền có thật đã
   * chảy qua ngân hàng mà không còn dòng nào trỏ tới nó.
   */
  async remove(id: number, user: IUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException(
        'Chỉ admin mới được xoá giao dịch thanh toán',
      );
    }
    await this.findOne(id, user);
    await this.paymentRepository.delete(id);
    return 'Xóa giao dịch thành công';
  }
}
