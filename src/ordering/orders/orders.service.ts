import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { PaymentMethod } from '@common/enums/payment.enum';
import { OrderItem } from './entities/order-item.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { User } from '@identity/users/entities/user.entity';
import { DataSource, EntityManager, Repository, In } from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { GhnService } from '@ordering/ghn/ghn.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { PayosService } from '@money/payos/payos.service';
import { assertTransitionAllowed, OrderActor } from './order-status.policy';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly ghnService: GhnService,
    private readonly escrowsService: EscrowsService,
    private readonly payosService: PayosService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getStats() {
    const total_users = await this.userRepository.count();
    const total_products = await this.productRepository.count();
    const total_orders = await this.orderRepository.count();

    const revenueResult = await this.orderRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.final_amount), 0)', 'total')
      .where('order.status != :cancelled', { cancelled: 'cancelled' })
      .getRawOne();

    const total_revenue = Number(revenueResult?.total || 0);

    return { total_users, total_products, total_orders, total_revenue };
  }

  async create(createOrderDto: CreateOrderDto, user: IUser) {
    const {
      shipping_address,
      receiver_name,
      receiver_phone,
      province,
      district,
      note,
      payment_method,
      cart_item_ids,
    } = createOrderDto;

    const cartWhere: any = { user: { id: user.id } };
    if (cart_item_ids && cart_item_ids.length > 0) {
      cartWhere.id = In(cart_item_ids);
    }

    const cartItems = await this.cartRepository.find({
      where: cartWhere,
      relations: ['product'],
    });

    if (cartItems.length === 0) {
      throw new BadRequestException('Giỏ hàng trống, không thể tạo đơn hàng');
    }

    if (cart_item_ids && cart_item_ids.length > 0) {
      const foundIds = cartItems.map((c) => c.id);
      const missing = cart_item_ids.filter((id) => !foundIds.includes(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Một số sản phẩm trong giỏ hàng không tồn tại: ${missing.join(', ')}`,
        );
      }
    }

    let totalAmount = 0;
    // Tiền tệ của đơn, lấy từ món ĐẦU TIÊN rồi bắt các món sau phải khớp.
    let orderCurrency = '';
    const orderItemsData: Array<{
      product: { id: number };
      product_name: string;
      product_image: string;
      price: number;
      quantity: number;
      subtotal: number;
    }> = [];

    for (const cartItem of cartItems) {
      const product = cartItem.product;
      if (!product) {
        throw new NotFoundException(
          `Sản phẩm ID ${cartItem.product.id} không tồn tại`,
        );
      }

      if (product.seller?.id === user.id) {
        throw new BadRequestException(
          `Bạn không thể mua sản phẩm "${product.name}" của chính mình`,
        );
      }

      if (product.stock < cartItem.quantity) {
        throw new BadRequestException(
          `Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho`,
        );
      }

      // CỘNG TIỀN THÌ PHẢI CÙNG MỘT LOẠI TIỀN.
      //
      // Vòng lặp này cộng giá của mọi món trong giỏ vào một con số duy nhất.
      // Chừng nào cả sàn còn một tiền tệ thì không sao, nhưng cột
      // `products.currency` vừa thêm khiến điều đó không còn được bảo đảm —
      // và một phép cộng 500 USD + 500 VND ra 1000 thì không báo lỗi ở đâu cả,
      // nó chỉ lặng lẽ tính sai hoá đơn.
      //
      // Ở đây TỪ CHỐI thay vì quy đổi: quy đổi cần nguồn tỉ giá và thời điểm
      // chốt giá, mà cả hai đều chưa có. Từ chối kèm câu giải thích là hành vi
      // đúng duy nhất khi chưa đủ dữ liệu để làm cho đúng.
      const itemCurrency = product.currency || 'VND';
      if (orderCurrency && itemCurrency !== orderCurrency) {
        throw new BadRequestException(
          `Giỏ hàng đang có ${orderCurrency} lẫn ${itemCurrency}. ` +
            'Mỗi đơn chỉ thanh toán được một loại tiền — tách thành hai đơn giúp mình.',
        );
      }
      orderCurrency = itemCurrency;

      const subtotal = Number(product.price) * cartItem.quantity;
      totalAmount += subtotal;

      orderItemsData.push({
        product: { id: product.id },
        product_name: product.name,
        product_image: product.image,
        price: product.price,
        quantity: cartItem.quantity,
        subtotal,
      });
    }

    const shippingFee = Number(createOrderDto.shipping_fee ?? 0);
    const discountAmount = 0;
    const finalAmount = totalAmount + shippingFee - discountAmount;

    const now = new Date();
    const orderCode = `ORD-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

    const order = this.orderRepository.create({
      order_code: orderCode,
      user: { id: user.id },
      total_amount: totalAmount,
      shipping_fee: shippingFee,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      // Chụp lại, không đọc lại từ sản phẩm lúc hiển thị: người bán sửa tiền tệ
      // của tin đăng sau này thì đơn cũ vẫn phải giữ đúng thứ đã thoả thuận.
      currency: orderCurrency || 'VND',
      status: OrderStatus.PENDING,
      payment_method: payment_method || PaymentMethod.COD,
      is_paid: false,
      receiver_name,
      receiver_phone,
      shipping_address,
      province,
      district,
      note,
      ghn_district_id: createOrderDto.ghn_district_id,
      ghn_ward_code: createOrderDto.ghn_ward_code,
    });

    const savedOrder = await this.orderRepository.save(order);

    const orderItems = orderItemsData.map((item) => ({
      ...item,
      order: { id: savedOrder.id },
    }));

    await this.orderItemRepository.save(orderItems);

    // Decrement product stock
    for (const item of orderItemsData) {
      await this.productRepository.decrement(
        { id: item.product.id },
        'stock',
        item.quantity,
      );
    }

    await this.cartRepository.delete(cartItems.map((c) => c.id));

    await this.notificationsService.create({
      user_id: user.id,
      type: 'order_status' as any,
      title: 'Đặt hàng thành công',
      content: `Đơn hàng ${orderCode} đã được đặt thành công với tổng ${finalAmount.toLocaleString('vi-VN')}đ`,
      data: { order_id: savedOrder.id, order_code: orderCode },
    });

    const result: any = await this.findOne(savedOrder.id, user);
    // Đánh dấu payment_method để frontend biết cần gọi PayOS
    result.needs_payOS = payment_method === PaymentMethod.PAYOS;
    return result;
  }

  async findAll(
    currentPage: string,
    limit: string,
    status: string,
    user: IUser,
    viewAs?: string,
  ) {
    const numPage = currentPage ? parseInt(currentPage) : 1;
    const numLimit = limit ? parseInt(limit) : 10;
    const offset = (numPage - 1) * numLimit;

    const filterQb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoin('order.items', 'item')
      .leftJoin('item.product', 'product')
      .leftJoin('product.seller', 'seller')
      .select('order.id', 'order_id');

    if (viewAs === 'seller') {
      filterQb.where('seller.id = :sellerId', { sellerId: user.id });
    } else if (user.role !== 'admin') {
      filterQb.where('order.user_id = :userId', { userId: user.id });
    }
    if (status) {
      filterQb.andWhere('order.status = :status', { status });
    }

    const idsRaw = await filterQb
      .orderBy('order.created_at', 'DESC')
      .getRawMany();

    /**
     * Câu trên JOIN sang order.items, nên mỗi ĐƠN trả về một dòng CHO MỖI MÓN.
     * Hai lỗi từ đó:
     *
     * 1. `ids.length` đếm dòng đã join chứ không phải số đơn. Đo được với dữ
     *    liệu thật: 3 đơn có 1 + 2 + 1 = 4 món, API trả về meta.total = 4 trong
     *    khi result chỉ có 3 phần tử — vì `In(ids)` tự khử trùng. Giao diện
     *    người bán hiện "4 đơn hàng" rồi liệt kê 3.
     *
     * 2. `offset` và `numLimit` được tính ở đầu hàm rồi KHÔNG BAO GIỜ dùng.
     *    Không có skip/take ở đâu cả, nên mọi lần gọi đều trả về TOÀN BỘ đơn
     *    khớp điều kiện, bất kể currentPage và limit. Người bán có 500 đơn thì
     *    tải cả 500 về mỗi lần mở trang.
     *
     * Khử trùng bằng Set thay vì DISTINCT của SQL: thứ tự đã do ORDER BY quyết
     * định, còn DISTINCT kèm ORDER BY trên cột không nằm trong SELECT là chỗ
     * MySQL hay từ chối tuỳ chế độ.
     */
    const seen = new Set<number>();
    const allIds: number[] = [];
    for (const row of idsRaw) {
      const n = Number(row.order_id);
      if (!isNaN(n) && !seen.has(n)) {
        seen.add(n);
        allIds.push(n);
      }
    }

    const totalItems = allIds.length;
    const pageIds = allIds.slice(offset, offset + numLimit);

    let result: any[] = [];
    if (pageIds.length > 0) {
      result = await this.orderRepository.find({
        where: { id: In(pageIds) },
        relations: ['user', 'items', 'items.product'],
        order: { created_at: 'DESC' },
      });
    }

    const totalPages = Math.ceil(totalItems / numLimit);

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: totalPages,
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

    const order = await this.orderRepository.findOne({
      where,
      relations: ['user', 'items', 'items.product'],
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    return order;
  }

  /**
   * Nạp đơn và xác định người gọi là ai ĐỐI VỚI đơn này.
   *
   * `findOne()` không dùng được ở đây: nó lọc theo `order.user_id`, nên người
   * bán luôn nhận 404 cho chính đơn hàng của họ — đó là lý do người bán chưa
   * bao giờ xác nhận được đơn qua API.
   *
   * Không tìm thấy quan hệ nào thì trả 404 chứ không phải 403, để người ngoài
   * không dò được đơn nào tồn tại.
   */
  private async findOneForActor(
    id: number,
    user: IUser,
  ): Promise<{ order: Order; actors: OrderActor[] }> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['user', 'items', 'items.product', 'items.product.seller'],
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    const actors: OrderActor[] = [];
    if (user.role === 'admin') actors.push(OrderActor.ADMIN);
    if (order.user?.id === user.id) actors.push(OrderActor.BUYER);
    // Một đơn có thể gồm hàng của nhiều người bán; là người bán của bất kỳ
    // món nào cũng đủ để xử lý đơn.
    if (order.items?.some((item) => item.product?.seller?.id === user.id)) {
      actors.push(OrderActor.SELLER);
    }

    if (!actors.length) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    return { order, actors };
  }

  /**
   * Đổi trạng thái đơn hàng.
   *
   * Luật ai-được-làm-gì nằm ở `order-status.policy.ts`. Ở đây chỉ điều phối.
   *
   * Thứ tự cố ý: LƯU trạng thái trước, chuyển tiền sau. Chưa có transaction
   * chung giữa Ordering và Money (việc của tuần 3, khi escrow đi qua ledger),
   * nên phải chọn kiểu hỏng ít tệ hơn:
   *  - Tiền trước, lưu sau: nếu lưu hỏng thì đơn vẫn là `shipping`, người mua
   *    bấm lại là nhả tiền LẦN HAI. Mất tiền thật.
   *  - Lưu trước, tiền sau: nếu tiền hỏng thì đơn đã là `delivered`, bấm lại
   *    bị bảng chuyển trạng thái chặn, và job đối soát sẽ phát hiện lệch.
   *    Admin chạy lại giải ngân là xong.
   * Chọn cái thứ hai.
   */
  async updateStatus(id: number, updateOrderDto: UpdateOrderDto, user: IUser) {
    const { order, actors } = await this.findOneForActor(id, user);
    const isAdmin = actors.includes(OrderActor.ADMIN);
    const nextStatus = updateOrderDto.status;

    if (nextStatus) {
      assertTransitionAllowed(order.status, nextStatus, actors);
    }

    // Đánh dấu đã thanh toán là thao tác tiền, không phải thao tác đơn hàng.
    // Đường đi bình thường là webhook PayOS; ở đây chỉ dành cho admin xác nhận
    // tay các đơn COD.
    if (updateOrderDto.is_paid !== undefined && !isAdmin) {
      throw new ForbiddenException(
        'Chỉ admin mới được đánh dấu đơn hàng đã thanh toán',
      );
    }

    // Mã vận đơn do người bán hoặc admin điền
    if (updateOrderDto.tracking_code !== undefined) {
      if (!isAdmin && !actors.includes(OrderActor.SELLER)) {
        throw new ForbiddenException(
          'Chỉ người bán hoặc admin mới được sửa mã vận đơn',
        );
      }
      order.tracking_code = updateOrderDto.tracking_code;
    }

    this.applyDeliveryInfo(order, updateOrderDto, actors);

    // Tạo vận đơn GHN khi người bán xác nhận. Lỗi GHN KHÔNG chặn việc xác
    // nhận — vận đơn không phải tiền, thiếu thì điền tay sau được.
    if (
      nextStatus === OrderStatus.CONFIRMED &&
      !order.tracking_code &&
      order.ghn_district_id
    ) {
      await this.tryCreateGhnOrder(order);
    }

    if (updateOrderDto.is_paid === true && !order.is_paid) {
      await this.escrowsService.createOrderEscrows(order.id);
      order.is_paid = true;
      order.paid_at = new Date();
    }

    if (nextStatus) {
      order.status = nextStatus;
    }

    await this.orderRepository.save(order);

    // Tiền đi sau khi trạng thái đã lưu. Lỗi ở đây được NÉM RA, không nuốt:
    // trước đây `catch { console.error }` khiến API trả 200 trong khi tiền
    // không hề chuyển, và không ai biết cho tới lúc đối soát.
    if (nextStatus === OrderStatus.DELIVERED) {
      await this.releaseEscrowOrExplain(order.id, 'giải ngân');
    }
    if (nextStatus === OrderStatus.REFUNDED) {
      await this.releaseEscrowOrExplain(order.id, 'hoàn tiền');
    }

    return this.orderRepository.findOne({
      where: { id: order.id },
      relations: ['user', 'items', 'items.product'],
    });
  }

  /**
   * Các trường địa chỉ giao hàng. Trước đây DTO nhận chúng rồi bỏ đi im lặng —
   * client sửa địa chỉ, API trả 200, không có gì thay đổi.
   */
  private applyDeliveryInfo(
    order: Order,
    dto: UpdateOrderDto,
    actors: OrderActor[],
  ): void {
    const fields = [
      'shipping_address',
      'receiver_name',
      'receiver_phone',
      'province',
      'district',
      'note',
    ] as const;

    const touched = fields.filter((f) => dto[f] !== undefined);
    if (!touched.length) return;

    const isAdmin = actors.includes(OrderActor.ADMIN);
    if (!isAdmin) {
      if (!actors.includes(OrderActor.BUYER)) {
        throw new ForbiddenException(
          'Chỉ người mua hoặc admin mới được sửa thông tin giao hàng',
        );
      }
      // Hàng đã rời kho thì đổi địa chỉ không còn nghĩa lý gì
      if (order.status !== OrderStatus.PENDING) {
        throw new BadRequestException(
          'Chỉ sửa được thông tin giao hàng khi đơn còn ở trạng thái Chờ xác nhận',
        );
      }
    }

    for (const field of touched) {
      (order as any)[field] = dto[field];
    }
  }

  private async tryCreateGhnOrder(order: Order): Promise<void> {
    try {
      const ghnOrder = await this.ghnService.createOrder({
        to_name: order.receiver_name,
        to_phone: order.receiver_phone,
        to_address: order.shipping_address,
        to_ward_code: order.ghn_ward_code,
        to_district_id: order.ghn_district_id,
        weight: 500,
        cod_amount:
          order.payment_method === 'cod' ? Number(order.final_amount) : 0,
        items: order.items.map((item) => ({
          name: item.product_name,
          quantity: item.quantity,
          weight: 200,
          price: item.price,
        })),
      });
      order.tracking_code = ghnOrder.order_code;
    } catch (err) {
      console.error('Tạo vận đơn GHN thất bại:', (err as Error).message);
    }
  }

  private async releaseEscrowOrExplain(
    orderId: number,
    action: 'giải ngân' | 'hoàn tiền',
  ): Promise<void> {
    try {
      if (action === 'giải ngân') {
        await this.escrowsService.release(orderId);
      } else {
        await this.escrowsService.refund(orderId);
      }
    } catch (err) {
      throw new BadRequestException(
        `Đã cập nhật trạng thái đơn hàng nhưng ${action} ký quỹ thất bại: ` +
          `${(err as Error).message}. Trạng thái đơn đã lưu, cần admin chạy lại ` +
          `bước ${action}.`,
      );
    }
  }

  /**
   * Phần chung của huỷ đơn: hoàn ký quỹ, đổi trạng thái, trả hàng về kho.
   * BA VIỆC MỘT SỐ PHẬN.
   *
   * Trước đây ba việc này là ba lần ghi rời, và lời gọi hoàn tiền còn bị bọc
   * `try/catch` chỉ `console.error`. Hoàn tiền hỏng thì đơn VẪN được ghi là đã
   * huỷ, tiền người mua nằm lại trong `escrow_hold` vĩnh viễn và không ai
   * được báo — chỉ còn một dòng log không ai đọc.
   */
  private async applyCancellation(order: Order) {
    await this.dataSource.transaction(async (em: EntityManager) => {
      if (order.is_paid) {
        try {
          await this.escrowsService.refund(order.id, em);
        } catch (err) {
          // CHỈ nuốt đúng một trường hợp: đơn trả tiền từ trước khi hệ thống
          // ký quỹ tồn tại nên không có bản ghi nào để hoàn. Mọi lỗi khác
          // phải làm hỏng cả transaction — tiền chưa về mà đơn đã ghi là huỷ
          // thì người mua mất trắng.
          if (!(err instanceof NotFoundException)) throw err;
          this.logger.warn(
            `Đơn #${order.id} có is_paid=1 nhưng không còn khoản ký quỹ nào ` +
              'đang giữ. Vẫn cho huỷ, nhưng cần đối soát tay xem tiền ở đâu.',
          );
        }
      }

      order.status = OrderStatus.CANCELLED;
      await em.save(Order, order);

      for (const item of order.items) {
        if (item.product) {
          await em.increment(
            Product,
            { id: item.product.id },
            'stock',
            item.quantity,
          );
        }
      }
    });
  }

  /**
   * Đóng link thanh toán còn treo, SAU khi transaction đã commit.
   *
   * Không gọi trong transaction: đây là lời gọi mạng ra PayOS, giữ khoá
   * database suốt thời gian chờ mạng là cách tự tạo deadlock.
   */
  private async voidOpenPaymentLink(orderId: number) {
    if (await this.payosService.voidOpenLinkForOrder(orderId)) {
      this.logger.log(`Đã đóng link thanh toán còn treo của đơn #${orderId}`);
    }
  }

  private assertCancellable(order: Order, action: string) {
    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CONFIRMED
    ) {
      throw new BadRequestException(
        `Chỉ có thể ${action} ở trạng thái Chờ xác nhận hoặc Đã xác nhận`,
      );
    }
  }

  async cancel(id: number, user: IUser) {
    const order = await this.findOne(id, user);
    this.assertCancellable(order, 'hủy đơn hàng');

    await this.applyCancellation(order);
    await this.voidOpenPaymentLink(order.id);

    return this.findOne(id, user);
  }

  /**
   * Huỷ đơn do HỆ THỐNG quyết định, không có người dùng nào đứng sau.
   *
   * Chỉ job quá hạn gọi tới. Tách riêng khỏi `cancel()` vì `cancel()` bắt đầu
   * bằng `findOne(id, user)` — hàm đó kiểm quyền, mà cron thì không có `user`
   * để kiểm. Phần còn lại đi CHUNG đúng một đường với người dùng bấm huỷ:
   * cùng transaction, cùng thứ tự, cùng bước đóng link.
   *
   * Trước 14/08 job quá hạn tự chép lại luồng huỷ theo cách riêng và chép sai:
   * đặt trạng thái huỷ và trả hàng về kho TRƯỚC, hoàn tiền SAU, cả ba là ba
   * lần ghi rời nhau, và lỗi hoàn tiền chỉ bị `logger.error` rồi đi tiếp. Đơn
   * huỷ xong, hàng về kho, tiền người mua kẹt trong `escrow_hold` vĩnh viễn —
   * đúng con bug đã sửa ở `cancel()` nhưng còn sống nguyên trong cron.
   */
  async cancelExpired(orderId: number): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product'],
    });
    if (!order) return;

    this.assertCancellable(order, 'hủy đơn quá hạn');
    await this.applyCancellation(order);
    await this.voidOpenPaymentLink(order.id);
  }

  async remove(id: number, user: IUser) {
    const order = await this.findOne(id, user);
    await this.orderRepository.softDelete(id);
    return { message: 'Xóa đơn hàng thành công' };
  }

  async findOneForSeller(orderId: number, sellerId: number) {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product', 'items.product.seller'],
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    const isSeller = order.items.some(
      (item) => item.product?.seller?.id === sellerId,
    );
    if (!isSeller) {
      throw new ForbiddenException(
        'Bạn không phải người bán trong đơn hàng này',
      );
    }

    return order;
  }

  async cancelSale(orderId: number, user: IUser) {
    const order = await this.findOneForSeller(orderId, user.id);
    this.assertCancellable(order, 'hủy bán đơn hàng');

    // Dùng chung đúng một đường huỷ với `cancel()`. Trước đây hai hàm này là
    // hai bản chép tay của cùng một việc, thứ tự các bước còn khác nhau — nên
    // sửa một chỗ là bỏ sót chỗ kia.
    await this.applyCancellation(order);
    await this.voidOpenPaymentLink(order.id);

    return { message: 'Hủy bán thành công', order_id: order.id };
  }
}
