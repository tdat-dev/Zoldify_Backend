import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ShipmentTrackingService } from './shipment-tracking.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { PaymentMethod } from '@common/enums/payment.enum';
import { OrderItem } from './entities/order-item.entity';
import {
  OrderShipment,
  ShipmentStatus,
} from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import { Product } from '@catalog/products/entities/product.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { User } from '@identity/users/entities/user.entity';
import {
  DataSource,
  EntityManager,
  Repository,
  In,
  IsNull,
  LessThan,
} from 'typeorm';
import { IUser } from '@identity/users/users.interface';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { GhnService } from '@ordering/ghn/ghn.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { PayosService } from '@money/payos/payos.service';
import { assertTransitionAllowed, OrderActor } from './order-status.policy';
import {
  normalizePagination,
  decodeCursor,
  encodeCursor,
} from '@common/dto/pagination.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(OrderShipment)
    private readonly shipmentRepository: Repository<OrderShipment>,
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
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
    private readonly shipmentTracking: ShipmentTrackingService,
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
      // product.seller cần cho: chặn tự mua, và gom theo người bán để tính phí
      // ship từng người (from = pickup người bán).
      relations: ['product', 'product.seller'],
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

    // Phí ship do SERVER tính, không tin số client gửi lên. Khi người mua đã
    // chọn địa chỉ chuẩn GHN, tính phí theo từng người bán (from = pickup của
    // họ) rồi cộng lại. Lỗi GHN KHÔNG chặn đặt hàng — rơi về số client gửi
    // (hoặc 0), điền/đối soát sau.
    let shippingFee = Number(createOrderDto.shipping_fee ?? 0);
    if (createOrderDto.ghn_district_id && createOrderDto.ghn_ward_code) {
      try {
        const quote = await this.quoteShippingBySellerFromCart(
          cartItems,
          createOrderDto.ghn_district_id,
          createOrderDto.ghn_ward_code,
        );
        shippingFee = quote.total;
      } catch (err) {
        this.logger.error(
          `Tính phí ship thất bại (đơn của user ${user.id}): ${(err as Error).message}`,
        );
      }
    }
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
    cursor?: string,
  ) {
    // Chuẩn hoá + CHẶN tham số: ép limit ≤ MAX_PAGE_SIZE, page ≥ 1, loại NaN/âm.
    // Không có bước này thì ?limit=1000000 nạp cả triệu đơn vào RAM (đúng bug
    // findAll vừa sửa, chỉ khác đường vào).
    const {
      page: numPage,
      size: numLimit,
      offset,
    } = normalizePagination(currentPage, limit);

    const isSeller = viewAs === 'seller';

    /**
     * Câu lọc DÙNG CHUNG cho cả đếm total lẫn lấy ID của trang.
     *
     * Vì sao dựng lại query mỗi lần (buildBase) thay vì clone: getCount() và
     * getRawMany() thêm SELECT/LIMIT khác nhau lên cùng một builder — tách hẳn
     * cho sạch, không dính trạng thái của nhau.
     *
     * Chỉ JOIN sang items→product khi lọc theo NGƯỜI BÁN. Buyer/admin KHÔNG join
     * gì cả: chỉ quét bảng orders (dùng idx_user_created / idx_created_at) rồi
     * LIMIT ở SQL — không đụng tới order_items khổng lồ, không nhân dòng.
     */
    const buildBase = () => {
      const qb = this.orderRepository.createQueryBuilder('order');
      if (isSeller) {
        // Lọc trực tiếp qua product.seller_id, khỏi join thêm bảng users.
        qb.innerJoin('order.items', 'item')
          .innerJoin('item.product', 'product')
          .where('product.seller_id = :sellerId', { sellerId: user.id });
      } else if (user.role !== 'admin') {
        qb.where('order.user_id = :userId', { userId: user.id });
      }
      if (status) {
        qb.andWhere('order.status = :status', { status });
      }
      return qb;
    };

    /**
     * 1) Tổng số ĐƠN (không phải số dòng join). getCount() của TypeORM đếm
     *    DISTINCT khoá chính gốc, nên seller-view có nhiều item trên một đơn
     *    vẫn ra đúng số đơn — sửa luôn bug meta.total đếm theo món trước đây.
     */
    const total = await buildBase().getCount();

    /**
     * 2) Lấy đúng ID của TRANG hiện tại. Hai chế độ, TƯƠNG THÍCH NGƯỢC:
     *    - Không có `cursor` → OFFSET như cũ (frontend đang gửi `currentPage`
     *      vẫn chạy y nguyên).
     *    - Có `cursor` → KEYSET: thêm điều kiện `(created_at,id) < con_trỏ` rồi
     *      LIMIT, đi thẳng vào index thay vì quét bỏ OFFSET dòng. Trang sâu nhanh
     *      như trang đầu (OFFSET 500k ~2.8s → keyset ~vài chục ms).
     */
    const cursorPos = cursor ? decodeCursor(cursor) : null;
    const idQb = buildBase()
      .select('order.id', 'id')
      // Lấy created_at dạng CHUỖI đủ micro-giây (%f) để dựng con trỏ chính xác —
      // KHÔNG lấy qua entity Date (bị cắt còn mili-giây). ORDER BY vẫn trên cột
      // thô nên index không bị ảnh hưởng.
      .addSelect(
        "DATE_FORMAT(order.created_at, '%Y-%m-%d %H:%i:%s.%f')",
        'cts',
      )
      // Tiebreaker theo id: created_at có thể trùng (seed rải theo giây), thiếu
      // khoá phụ thì thứ tự ở ranh giới trang không ổn định giữa các lần gọi.
      .orderBy('order.created_at', 'DESC')
      .addOrderBy('order.id', 'DESC')
      .limit(numLimit);
    if (isSeller) {
      // JOIN sinh nhiều dòng/đơn → cần DISTINCT. Thêm created_at vào SELECT để
      // hợp lệ với ORDER BY khi có DISTINCT (MySQL ONLY_FULL_GROUP_BY).
      idQb.distinct(true).addSelect('order.created_at', 'created_at');
    }
    if (cursorPos) {
      idQb.andWhere(
        '(order.created_at < :cts OR (order.created_at = :cts AND order.id < :cid))',
        { cts: cursorPos.createdAt, cid: cursorPos.id },
      );
    } else {
      idQb.offset(offset);
    }
    const idRows = await idQb.getRawMany();
    const pageIds = idRows.map((r) => Number(r.id));

    // 3) Nạp đầy đủ CHỈ các đơn của trang này (tối đa numLimit bản ghi).
    let result: Order[] = [];
    if (pageIds.length > 0) {
      result = await this.orderRepository.find({
        where: { id: In(pageIds) },
        relations: ['user', 'items', 'items.product'],
        order: { created_at: 'DESC', id: 'DESC' },
      });
    }

    // Con trỏ cho trang KẾ: chỉ cấp khi trang này đầy (còn khả năng có tiếp).
    // Lấy từ idRows (có 'cts' đủ µs) chứ KHÔNG từ entity result (Date bị cắt ms).
    // Client cứ truyền lại `?cursor=<nextCursor>` để lấy trang sau — không cần
    // biết offset, và không chậm dần theo độ sâu.
    const lastRaw = idRows[idRows.length - 1];
    const nextCursor =
      idRows.length === numLimit && lastRaw
        ? encodeCursor(lastRaw.cts, Number(lastRaw.id))
        : null;

    return {
      meta: {
        current: numPage,
        pageSize: numLimit,
        pages: Math.ceil(total / numLimit),
        total,
        nextCursor,
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
      relations: ['user', 'items', 'items.product', 'items.product.seller'],
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    // Đính kèm vận đơn theo từng người bán để giao diện hiện trạng thái giao và
    // nút "Đã nhận hàng" cho đúng người bán. OrderShipment là bảng riêng (mirror
    // (order, seller)), không phải quan hệ trên Order — nên tra riêng rồi gắn.
    const shipments = await this.shipmentRepository.find({
      where: { order: { id } },
      relations: ['seller'],
    });
    (order as any).shipments = shipments;

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

    // Tạo vận đơn GHN khi người bán xác nhận — MỘT vận đơn cho MỖI người bán,
    // gửi từ địa chỉ của chính họ. Lỗi GHN KHÔNG chặn việc xác nhận: vận đơn
    // không phải tiền, thiếu thì điền tay sau được. Idempotent theo (đơn, người
    // bán) nên gọi lại không tạo trùng.
    if (nextStatus === OrderStatus.CONFIRMED && order.ghn_district_id) {
      await this.createGhnShipmentsPerSeller(order);
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
   * Người mua xác nhận ĐÃ NHẬN HÀNG của MỘT người bán trong đơn → giải ngân
   * escrow của đúng người bán đó.
   *
   * Vì sao theo từng người bán: đơn C2C có thể gồm hàng nhiều người bán, mỗi
   * người một vận đơn GHN riêng, giao xong ở những thời điểm khác nhau. Bắt
   * người mua chờ tất cả rồi mới nhả tiền cho ai là giữ tiền của người bán đã
   * giao xong một cách vô cớ — đúng khuôn Shopee/Lazada: nhận của ai, chốt của
   * người đó.
   *
   * Tiền trước, đánh dấu sau: `release` khoá idempotent theo từng khoản ký quỹ,
   * nên nếu bước đánh dấu shipment hỏng, gọi lại chỉ no-op ở release rồi đánh
   * dấu tiếp — không bao giờ nhả tiền hai lần, cũng không để tiền kẹt.
   */
  async confirmShipmentReceived(
    orderId: number,
    sellerId: number,
    user: IUser,
  ) {
    const { order, actors } = await this.findOneForActor(orderId, user);
    const isAdmin = actors.includes(OrderActor.ADMIN);
    const isBuyer = actors.includes(OrderActor.BUYER);
    if (!isBuyer && !isAdmin) {
      throw new ForbiddenException('Chỉ người mua mới xác nhận đã nhận hàng');
    }

    const shipment = await this.shipmentRepository.findOne({
      where: { order: { id: orderId }, seller: { id: sellerId } },
      relations: ['seller'],
    });
    if (!shipment) {
      throw new NotFoundException(
        'Không tìm thấy lô hàng của người bán này trong đơn',
      );
    }
    if (shipment.status === ShipmentStatus.RECEIVED) {
      return shipment; // đã xác nhận trước đó — idempotent
    }
    if (shipment.status === ShipmentStatus.FAILED) {
      throw new BadRequestException(
        'Lô hàng này chưa gửi được, chưa thể xác nhận đã nhận',
      );
    }

    await this.escrowsService.release(orderId, sellerId);

    const now = new Date();
    shipment.status = ShipmentStatus.RECEIVED;
    shipment.received_at = now;
    if (!shipment.delivered_at) shipment.delivered_at = now;
    await this.shipmentRepository.save(shipment);

    await this.reconcileOrderDelivered(orderId);

    return this.shipmentRepository.findOne({
      where: { id: shipment.id },
      relations: ['seller'],
    });
  }

  /**
   * Mọi lô (trừ lô FAILED) đã nhận → đơn coi như giao trọn. Đặt trạng thái
   * THẲNG, KHÔNG qua updateStatus: đường đó gọi giải ngân cấp-đơn lần nữa và
   * sẽ ném lỗi vì không còn khoản HOLDING nào.
   */
  private async reconcileOrderDelivered(orderId: number): Promise<void> {
    const shipments = await this.shipmentRepository.find({
      where: { order: { id: orderId } },
    });
    const active = shipments.filter((s) => s.status !== ShipmentStatus.FAILED);
    const allReceived =
      active.length > 0 &&
      active.every((s) => s.status === ShipmentStatus.RECEIVED);
    if (!allReceived) return;

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (order && order.status !== OrderStatus.DELIVERED) {
      order.status = OrderStatus.DELIVERED;
      await this.orderRepository.save(order);
    }
  }

  /**
   * Chạy tay lượt chốt vận đơn (đồng bộ GHN + tự xác nhận) — cho admin/ops khi
   * cần chốt ngay thay vì chờ cron hàng giờ. Cùng logic với job định kỳ.
   */
  async settleShipments(user: IUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Chỉ admin mới được chạy chốt vận đơn');
    }
    const sync = await this.syncGhnShipmentStatuses();
    const auto = await this.autoConfirmDueShipments();
    return { sync, auto };
  }

  /**
   * Đồng bộ trạng thái vận đơn từ GHN (chạy định kỳ). Lô đang 'created' mà GHN
   * báo 'delivered' thì chuyển sang DELIVERED và ghi mốc `delivered_at` — mốc
   * này là gốc để đếm cửa sổ tự-xác-nhận.
   *
   * KHÔNG giải ngân ở đây: 'đã giao tới cửa' chưa phải 'người mua đã nhận và
   * ưng'. Việc chốt tiền để cho `autoConfirmDueShipments` (sau N ngày) hoặc
   * người mua bấm tay.
   */
  async syncGhnShipmentStatuses(): Promise<{
    checked: number;
    delivered: number;
  }> {
    // Thân hàm chuyển sang ShipmentTrackingService ở task #26.
    //
    // Vì sao: webhook GHN (đường nhanh) và lượt quét này (lưới an toàn) làm
    // ĐÚNG một việc — chuyển lô sang 'đã giao' và ghi `delivered_at`. Để hai
    // bản sao là lặp lại đúng cái bẫy ghi ở đầu `tasks.service.ts`: bản sao
    // thứ hai của đường huỷ đơn từng chép kèm cả lỗi, để tiền người mua kẹt
    // trong `escrow_hold` không lối ra.
    //
    // Giữ nguyên phương thức này thay vì bắt TasksService gọi thẳng: nó là
    // hợp đồng công khai mà worker đang dùng, đổi chữ ký là đổi thêm một chỗ
    // không cần thiết.
    return this.shipmentTracking.dongBoTatCa();
  }

  /**
   * Tự xác nhận nhận hàng cho lô đã giao mà người mua quên bấm (giống Shopee/
   * Lazada). Lô ở DELIVERED, chưa nhận, và đã qua cửa sổ N ngày kể từ
   * `delivered_at` → giải ngân escrow người bán, đánh dấu RECEIVED với cờ
   * `auto_received`.
   *
   * Cùng thứ tự an toàn với bản bấm tay: tiền trước (idempotent), đánh dấu sau.
   * Một lô hỏng không làm chết cả lượt.
   */
  async autoConfirmDueShipments(): Promise<{ due: number; released: number }> {
    const days = Number(process.env.AUTO_CONFIRM_RECEIPT_DAYS ?? 3);
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

    const due = await this.shipmentRepository.find({
      where: {
        status: ShipmentStatus.DELIVERED,
        received_at: IsNull(),
        delivered_at: LessThan(cutoff),
      },
      relations: ['seller', 'order'],
    });

    let released = 0;
    for (const s of due) {
      const orderId = s.order?.id;
      const sellerId = s.seller?.id;
      if (!orderId || !sellerId) continue;
      try {
        await this.escrowsService.release(orderId, sellerId);
        s.status = ShipmentStatus.RECEIVED;
        s.received_at = new Date();
        s.auto_received = true;
        await this.shipmentRepository.save(s);
        await this.reconcileOrderDelivered(orderId);
        released += 1;
        this.logger.log(
          `Tự xác nhận nhận hàng sau ${days} ngày: đơn ${orderId}, người bán ${sellerId}`,
        );
      } catch (err) {
        this.logger.error(
          `Tự xác nhận lỗi (đơn ${orderId}, người bán ${sellerId}): ${(err as Error).message}`,
        );
      }
    }
    return { due: due.length, released };
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

  /**
   * Báo giá phí ship theo TỪNG người bán cho một địa chỉ nhận (GHN).
   *
   * Dùng cho hai chỗ: hiện breakdown ở checkout, và tính phí thật lúc tạo đơn.
   * Gom giỏ theo người bán, mỗi người tính phí riêng vì gửi từ địa chỉ (quận)
   * của họ. Người bán chưa khai pickup thì GHN dùng điểm gửi mặc định của sàn
   * (from_district_id để trống) — vẫn ra được một con số, cờ has_pickup=false
   * để client cảnh báo nếu muốn.
   *
   * Lỗi GHN của một người bán KHÔNG làm hỏng cả báo giá: phần đó tính 0 và kèm
   * error, các người bán khác vẫn có phí.
   */
  private async quoteShippingBySellerFromCart(
    cartItems: Cart[],
    toDistrictId: number,
    toWardCode: string,
  ): Promise<{
    total: number;
    items: Array<{
      seller_id: number;
      seller_name: string;
      fee: number;
      has_pickup: boolean;
      error?: string;
    }>;
  }> {
    const bySeller = new Map<number, { seller: User; weight: number }>();
    for (const ci of cartItems) {
      const seller = ci.product?.seller;
      if (!seller) continue;
      const g = bySeller.get(seller.id) || { seller, weight: 0 };
      g.weight += 200 * ci.quantity;
      bySeller.set(seller.id, g);
    }

    const sellerIds = Array.from(bySeller.keys());
    const shops = sellerIds.length
      ? await this.shopRepository.find({
          where: { user: { id: In(sellerIds) } },
          relations: ['user'],
        })
      : [];
    const shopByUser = new Map(shops.map((s) => [s.user.id, s]));

    let total = 0;
    const items: Array<{
      seller_id: number;
      seller_name: string;
      fee: number;
      has_pickup: boolean;
      error?: string;
    }> = [];
    for (const [sellerId, { seller, weight }] of bySeller) {
      const shop = shopByUser.get(sellerId);
      const hasPickup = !!(
        shop &&
        shop.pickup_district_id &&
        shop.pickup_ward_name &&
        shop.pickup_district_name &&
        shop.pickup_province_name
      );
      let fee = 0;
      let error: string | undefined;
      try {
        const res = await this.ghnService.calculateFee({
          to_district_id: toDistrictId,
          to_ward_code: toWardCode,
          weight: weight || 500,
          from_district_id: shop?.pickup_district_id || undefined,
        });
        fee = Number(res?.total || 0);
      } catch (e) {
        error = (e as Error).message;
      }
      total += fee;
      items.push({
        seller_id: sellerId,
        seller_name: shop?.name || seller.full_name || `#${sellerId}`,
        fee,
        has_pickup: hasPickup,
        error,
      });
    }
    return { total, items };
  }

  /**
   * Báo giá phí ship cho giỏ của người dùng — endpoint cho checkout hiện phí
   * theo từng shop trước khi đặt.
   */
  async getShippingQuote(
    userId: number,
    dto: {
      to_district_id: number;
      to_ward_code: string;
      cart_item_ids?: number[];
    },
  ) {
    const where: any = { user: { id: userId } };
    if (dto.cart_item_ids?.length) where.id = In(dto.cart_item_ids);
    const cartItems = await this.cartRepository.find({
      where,
      relations: ['product', 'product.seller'],
    });
    if (!cartItems.length) {
      throw new BadRequestException('Giỏ hàng trống');
    }
    return this.quoteShippingBySellerFromCart(
      cartItems,
      dto.to_district_id,
      dto.to_ward_code,
    );
  }

  /**
   * Tạo vận đơn GHN theo TỪNG người bán trong đơn.
   *
   * Sàn C2C: một đơn có thể gồm hàng của nhiều người bán, mỗi người tự gửi từ
   * nhà mình. Nên gom món theo người bán rồi tạo một vận đơn riêng cho mỗi
   * người — địa chỉ gửi là pickup của Shop người đó, tiền thu hộ (COD) là tổng
   * phần của riêng họ.
   *
   * Nguyên tắc:
   *  - Idempotent: đã có vận đơn cho (đơn, người bán) thì bỏ qua, không tạo lại.
   *  - Cô lập lỗi: người bán A hỏng KHÔNG chặn người bán B — mỗi người một
   *    try/catch, lỗi lưu vào shipment để còn nhìn thấy.
   *  - Fallback: người bán chưa khai địa chỉ lấy hàng thì bỏ trống from_*, GHN
   *    tự dùng địa chỉ shop nền tảng (header ShopId).
   */
  private async createGhnShipmentsPerSeller(order: Order): Promise<void> {
    // Gom món theo người bán (product.seller). Món mất product/seller (sản phẩm
    // đã xoá) thì không gửi được — bỏ qua.
    const bySeller = new Map<number, { seller: User; items: OrderItem[] }>();
    for (const item of order.items || []) {
      const seller = item.product?.seller;
      if (!seller) continue;
      const group = bySeller.get(seller.id);
      if (group) group.items.push(item);
      else bySeller.set(seller.id, { seller, items: [item] });
    }
    if (bySeller.size === 0) return;

    const sellerIds = Array.from(bySeller.keys());

    // Đã tạo vận đơn cho người bán nào rồi (chốt chặn tạo trùng).
    const existing = await this.shipmentRepository.find({
      where: { order: { id: order.id } },
      relations: ['seller'],
    });
    const shippedSellerIds = new Set(existing.map((s) => s.seller?.id));

    // Địa chỉ lấy hàng của các người bán, tra một lần.
    const shops = await this.shopRepository.find({
      where: { user: { id: In(sellerIds) } },
      relations: ['user'],
    });
    const shopByUser = new Map(shops.map((s) => [s.user.id, s]));

    const isCod = order.payment_method === PaymentMethod.COD;

    for (const [sellerId, { seller, items }] of bySeller) {
      if (shippedSellerIds.has(sellerId)) continue;

      const shop = shopByUser.get(sellerId);
      const from =
        shop &&
        shop.pickup_district_name &&
        shop.pickup_ward_name &&
        shop.pickup_province_name &&
        shop.pickup_address &&
        shop.pickup_name &&
        shop.pickup_phone
          ? {
              name: shop.pickup_name,
              phone: shop.pickup_phone,
              address: shop.pickup_address,
              ward_name: shop.pickup_ward_name,
              district_name: shop.pickup_district_name,
              province_name: shop.pickup_province_name,
            }
          : undefined;

      // GHN yêu cầu price/cod_amount là SỐ NGUYÊN. TypeORM trả cột decimal dạng
      // chuỗi ("100000.00"), truyền thẳng vào GHN sẽ bị từ chối — ép Number +
      // làm tròn ở mọi con số gửi đi.
      const codAmount = isCod
        ? Math.round(items.reduce((sum, i) => sum + Number(i.subtotal), 0))
        : 0;

      try {
        const ghnOrder = await this.ghnService.createOrder({
          to_name: order.receiver_name,
          to_phone: order.receiver_phone,
          to_address: order.shipping_address,
          to_ward_code: order.ghn_ward_code,
          to_district_id: order.ghn_district_id,
          weight: items.reduce((s, i) => s + 200 * i.quantity, 0),
          cod_amount: codAmount,
          items: items.map((item) => ({
            name: item.product_name,
            quantity: item.quantity,
            weight: 200,
            price: Math.round(Number(item.price)),
          })),
          from,
        });

        await this.shipmentRepository.save(
          this.shipmentRepository.create({
            order: { id: order.id } as Order,
            seller: { id: sellerId } as User,
            tracking_code: ghnOrder.order_code,
            cod_amount: codAmount,
            status: ShipmentStatus.CREATED,
          }),
        );

        // Giữ tương thích: UI cũ đọc order.tracking_code. Đơn một người bán vẫn
        // thấy mã như trước; đơn nhiều người bán lấy mã đầu tiên làm đại diện.
        if (!order.tracking_code) order.tracking_code = ghnOrder.order_code;
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(
          `Tạo vận đơn GHN thất bại cho người bán ${sellerId} (đơn ${order.id}): ${message}`,
        );
        await this.shipmentRepository.save(
          this.shipmentRepository.create({
            order: { id: order.id } as Order,
            seller: { id: sellerId } as User,
            cod_amount: codAmount,
            status: ShipmentStatus.FAILED,
            error: message,
          }),
        );
      }
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
