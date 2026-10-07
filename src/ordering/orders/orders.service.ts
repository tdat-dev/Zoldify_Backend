import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ShipmentTrackingService } from './shipment-tracking.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { StockEventsService } from '@catalog/stock/stock-events.service';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { PaymentMethod } from '@common/enums/payment.enum';
import { OrderItem } from './entities/order-item.entity';
import {
  OrderShipment,
  ShipmentStatus,
} from './entities/order-shipment.entity';
import { Cart } from '@ordering/carts/entities/cart.entity';
import {
  Product,
  ProductStatus,
} from '@catalog/products/entities/product.entity';
import { Shop } from '@catalog/shop/entities/shop.entity';
import { User } from '@identity/users/entities/user.entity';
import {
  DataSource,
  EntityManager,
  Repository,
  In,
  IsNull,
  LessThan,
  QueryFailedError,
} from 'typeorm';
import { randomUUID } from 'crypto';
import { IUser } from '@identity/users/users.interface';
import { NotificationsService } from '@messaging/notifications/notifications.service';
import { GhnService, ghnErrorMessage } from '@ordering/ghn/ghn.service';
import { EscrowsService } from '@money/escrows/escrows.service';
import { Escrow, EscrowStatus } from '@money/escrows/entities/escrow.entity';
import { PayosService } from '@money/payos/payos.service';
import { assertTransitionAllowed, OrderActor } from './order-status.policy';
import {
  normalizePagination,
  decodeCursor,
  encodeCursor,
} from '@common/dto/pagination.dto';

/** Mã lỗi MySQL khi đụng ràng buộc UNIQUE. Cùng hằng số mà `ledger.service.ts` dùng. */
const ER_DUP_ENTRY = 1062;

/**
 * Lỗi này có phải do đụng khoá UNIQUE không?
 *
 * Tách khỏi `create()` vì đây là chi tiết của driver, không phải của nghiệp vụ
 * đặt hàng. Cùng cách nhận diện với `LedgerService.isDuplicateKey`.
 */
function laLoiTrungKhoa(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as { errno?: number } | undefined;
  return driverError?.errno === ER_DUP_ENTRY;
}

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
    private readonly stockEvents: StockEventsService,
  ) {}

  async getStats() {
    const total_users = await this.userRepository.count();
    const total_products = await this.productRepository.count();
    const total_orders = await this.orderRepository.count();

    // DOANH THU CHỈ TÍNH ĐƠN ĐÃ CÓ TIỀN VỀ.
    //
    // Bản cũ cộng `final_amount` của mọi đơn khác `cancelled` — kể cả đơn
    // `pending` mà chưa ai trả một đồng nào. Con số đó hiện trên dashboard
    // admin và không có gì nói nó là "giá trị đơn đã đặt" chứ không phải
    // "tiền đã thu". Đo bằng TC-P3-21.
    //
    // Lọc theo `is_paid` chứ không theo trạng thái đơn: trạng thái nói hàng
    // đang ở đâu, `is_paid` mới nói tiền đã về hay chưa.
    const revenueResult = await this.orderRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.final_amount), 0)', 'total')
      .where('order.status != :cancelled', { cancelled: 'cancelled' })
      .andWhere('order.is_paid = 1')
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
        // BÁO ĐÚNG MÓN NÀO, VÀ ĐỪNG SẬP KHI BÁO.
        //
        // Bản cũ viết `cartItem.product.id` NGAY TRONG nhánh `product` là rỗng
        // — deref thẳng vào null. Người mua có một món đã bị gỡ bán trong giỏ
        // thì nhận `TypeError: Cannot read properties of null` và HTTP 500, thay
        // vì một câu tiếng Việt nói rõ phải bỏ món nào ra. Đo bằng TC-P2-13.
        //
        // `cartItem.id` thì luôn có — nó là khoá chính của dòng giỏ hàng, không
        // phụ thuộc vào việc sản phẩm còn sống hay không.
        throw new BadRequestException(
          `Một sản phẩm trong giỏ hàng (dòng #${cartItem.id}) đã ngừng bán ` +
            'hoặc bị gỡ khỏi sàn. Mời bạn xoá nó khỏi giỏ rồi đặt lại.',
        );
      }

      // CHỈ BÁN ĐƯỢC HÀNG ĐANG MỞ BÁN.
      //
      // Bản cũ kiểm tiền tệ, kiểm tự-mua-hàng-mình, kiểm tồn kho — nhưng không
      // kiểm `product.status`. Nên hàng `draft` (người bán còn đang soạn),
      // `pending` (chờ duyệt) và `rejected` (đã bị từ chối duyệt) đều đặt được
      // như hàng thường. Đo bằng TC-P1-10b.
      //
      // Kiểm ở đây, NGOÀI transaction, là đủ: `status` do người bán đổi bằng
      // thao tác tay chứ không đổi theo từng lượt mua, nên không có cửa sổ đua
      // đáng kể như `stock`.
      if (product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(
          `Sản phẩm "${product.name}" hiện không mở bán, không thể đặt hàng`,
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

    // PHÍ SHIP DO SERVER TÍNH — VÀ LẦN NÀY LÀ THẬT.
    //
    // Bình luận cũ ở đây viết đúng câu "không tin số client gửi lên", rồi dòng
    // ngay dưới nó lấy đúng số client gửi làm giá trị khởi tạo:
    //
    //     let shippingFee = Number(createOrderDto.shipping_fee ?? 0);
    //
    // Nó chỉ bị ghi đè khi client CÓ gửi cả `ghn_district_id` lẫn
    // `ghn_ward_code`, mà hai trường đó đều `@IsOptional`. Bỏ trống chúng là
    // phí ship bằng đúng thứ client muốn — kể cả 0. Đo bằng TC-P2-12.
    //
    // Nay khởi tạo bằng 0 và chỉ server mới ghi vào được. Thiếu địa chỉ GHN thì
    // không tính được phí, và "không tính được" phải ra 0 chứ không phải ra
    // con số người mua tự khai.
    //
    // Khối tính phí ngay dưới là của Đạt (lỗi H-07, 30/09): GHN tính không ra
    // thì TỪ CHỐI đặt đơn, không rơi về 0. Trước đó GHN lỗi là đơn vẫn tạo với
    // phí 0đ, app hiện "Miễn phí", rồi người bán mới phát hiện không tạo được
    // vận đơn và hàng kẹt giữa chừng.
    //
    // Hai bản vá phủ hai lỗ KHÁC NHAU nên phải có cả hai: của Đạt lo lúc CÓ
    // địa chỉ GHN mà tính lỗi; của vai B lo lúc client KHÔNG gửi địa chỉ GHN
    // (hai trường đó `@IsOptional`, bỏ trống là khối `if` không chạy).
    //
    // `shipping_fee` vẫn còn trong DTO nhưng bị BỎ QUA. Không gỡ khỏi DTO vì
    // `forbidNonWhitelisted: true` sẽ khiến frontend đang gửi trường đó nhận
    // 400 — gỡ là việc của một lần dọn riêng, sau khi frontend thôi gửi.
    let shippingFee = 0;
    if (
      createOrderDto.shipping_fee !== undefined &&
      Number(createOrderDto.shipping_fee) !== 0
    ) {
      this.logger.warn(
        `Client gửi shipping_fee=${createOrderDto.shipping_fee} khi đặt đơn của ` +
          `user ${user.id} — đã bỏ qua, phí ship do server tính.`,
      );
    }
    if (createOrderDto.ghn_district_id && createOrderDto.ghn_ward_code) {
      const quote = await this.quoteShippingBySellerFromCart(
        cartItems,
        createOrderDto.ghn_district_id,
        createOrderDto.ghn_ward_code,
      );
      if (!quote.ok) {
        const reason = quote.items.find((i) => i.error)?.error;
        this.logger.warn(
          `Từ chối đơn của user ${user.id}: không tính được phí ship (${reason})`,
        );
        throw new BadRequestException(
          `Chưa tính được phí vận chuyển tới địa chỉ này (${reason}). ` +
            'Chọn địa chỉ khác giúp mình.',
        );
      }
      shippingFee = quote.total;
    }
    const discountAmount = 0;
    const finalAmount = totalAmount + shippingFee - discountAmount;

    // MÃ ĐƠN PHẢI ĐỦ CHỖ CHO SỐ ĐƠN MỘT NGÀY.
    //
    // Bản cũ: `ORD-<ngày>-<random 0..999>` trên một cột UNIQUE. Chỉ có 1000 giá
    // trị mỗi ngày, mà theo nghịch lý sinh nhật thì xác suất trùng chạm 50% ở
    // khoảng 37 đơn/ngày — không phải 500 như trực giác mách.
    //
    // Đo bằng TC-P2-11: tạo 120 đơn trong một ngày thì 8-16 đơn ném
    // `Duplicate entry 'ORD-20260921-746' for key 'orders.IDX_...'`. Đó là 7-13%
    // người mua thật nhận HTTP 500 ở đúng bước bấm đặt hàng.
    //
    // Nay dùng 8 ký tự hex từ `crypto.randomBytes` — hơn 4 tỉ giá trị mỗi ngày.
    // Ở 1000 đơn/ngày xác suất trùng còn khoảng 1 phần 10 nghìn, và nếu vẫn
    // trùng thì ràng buộc UNIQUE của database vẫn là chốt chặn cuối: transaction
    // quay lui sạch, không để lại đơn dở hay kho bị trừ oan.
    //
    // Giữ nguyên tiền tố `ORD-<ngày>-` vì con người đọc nó, và đơn cũ trong
    // database vẫn khớp định dạng — không cần đụng dữ liệu lịch sử.
    const now = new Date();
    const ngay = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const orderCode = `ORD-${ngay}-${randomBytes(4).toString('hex').toUpperCase()}`;

    // KHOÁ CHỐNG TRÙNG — MỘT GIỎ, MỘT ĐƠN.
    //
    // Người mua bấm "Đặt hàng" hai lần (mạng chập, nút chưa bị khoá, trình duyệt
    // tự gửi lại) thì ra hai đơn và kho bị trừ hai lần. Đo bằng `check:race` R5:
    // 20 lượt bấm đồng thời → 20 đơn, kho trừ 20 lần.
    //
    // Kho không cứu được — còn nhiều thì mọi lượt đều qua cửa `stock >= n`.
    // Giỏ cũng không — nó chỉ bị xoá ở CUỐI transaction, nên bấm đồng thời thì
    // cả 20 lượt đều đọc giỏ trước khi ai kịp commit.
    //
    // ID DÒNG GIỎ HÀNG LÀ KHOÁ TỰ NHIÊN. Chúng bị xoá khi đặt hàng thành công,
    // và `carts.id` là auto-increment không tái sử dụng. Nên một "giỏ" chỉ đặt
    // được đúng một lần, còn người mua thêm lại cùng sản phẩm sau đó sẽ có dòng
    // giỏ mới → id mới → khoá mới → mua lại bình thường.
    //
    // Sắp xếp trước khi ghép: hai request song song có thể nhận cùng tập dòng
    // giỏ nhưng khác thứ tự (không có ORDER BY ở câu đọc giỏ), và khác thứ tự
    // thì ra hai chuỗi băm khác nhau — tức khoá chống trùng không chống gì cả.
    const khoaChongTrung = createHash('sha256')
      .update(
        `${user.id}:${cartItems
          .map((c) => c.id)
          .sort((a, b) => a - b)
          .join(',')}`,
      )
      .digest('hex');

    const order = this.orderRepository.create({
      order_code: orderCode,
      idempotency_key: khoaChongTrung,
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

    // ── TỪ ĐÂY TRỞ XUỐNG LÀ MỘT TRANSACTION ──────────────────────────────────
    //
    // Task #2 bảng phân công: "SELECT ... FOR UPDATE trong orders.create, chặn
    // kho về âm".
    //
    // Trước đây bốn việc dưới đây là bốn lần ghi rời: lưu đơn, lưu món, trừ
    // kho, xoá giỏ. Và việc kiểm kho nằm mãi ở trên, lúc duyệt giỏ. Giữa lúc
    // kiểm và lúc trừ có cả một quãng — lưu hai bảng, và trước đó còn hỏi phí
    // ship qua mạng. Hai mươi người bấm cùng lúc thì cả hai mươi đều đọc thấy
    // "còn 1", đều qua cửa, rồi đều trừ.
    //
    // Đo được bằng `npm run check:race` R1, gọi thẳng service này: kho 1 → bán
    // 20, còn **-19**. Kho âm nghĩa là hai mươi người đã trả tiền cho một món
    // hàng duy nhất.
    //
    // BA LỚP CHẶN, CÓ CHỦ ĐÍCH CHỒNG NHAU:
    //
    //   1. Khoá hàng sản phẩm (`FOR UPDATE`) rồi ĐỌC LẠI kho dưới khoá. Đây là
    //      lớp cho ra câu báo lỗi tử tế: "chỉ còn N trong kho".
    //   2. Trừ kho có điều kiện `WHERE stock >= n`, kiểm số dòng bị ảnh hưởng.
    //      Thừa khi đã có khoá — giữ lại có chủ đích: mai kia ai đó gỡ khoá đi
    //      thì kho vẫn không thể về âm, vì database từ chối chứ không phải mã
    //      từ chối.
    //   3. Cả khối trong một transaction: giỏ hai món mà món thứ hai hết hàng
    //      thì món thứ nhất KHÔNG bị trừ, và không còn cái đơn dở dang nào.
    //
    // KHOÁ THEO THỨ TỰ id TĂNG DẦN. Hai người mua hai giỏ có chung hai sản phẩm
    // nhưng thứ tự ngược nhau sẽ khoá chéo và MySQL giết một bên. Cùng đi theo
    // một thứ tự thì không có vòng chờ.
    //
    // Việc hỏi phí ship qua GHN nằm Ở TRÊN, ngoài transaction — có chủ đích.
    // Giữ khoá hàng trong lúc chờ mạng là cách chắc chắn nhất để một sự cố GHN
    // biến thành sự cố database.
    const idTheoThuTu = [
      ...new Set(orderItemsData.map((i) => i.product.id)),
    ].sort((a, b) => a - b);

    const chayTransaction = () =>
      this.dataSource.transaction(async (em: EntityManager) => {
        const daKhoa = await em
          .createQueryBuilder(Product, 'p')
          .setLock('pessimistic_write')
          .where('p.id IN (:...ids)', { ids: idTheoThuTu })
          .orderBy('p.id', 'ASC')
          .getMany();

        const khoThat = new Map(daKhoa.map((p) => [p.id, Number(p.stock)]));
        // GIÁ CŨNG PHẢI ĐỌC LẠI DƯỚI KHOÁ, KHÔNG CHỈ KHO.
        //
        // Vòng duyệt giỏ ở trên đọc `product.price` NGOÀI transaction, rồi tính
        // `subtotal`, `total_amount`, `final_amount` từ đó. Giữa lúc ấy và lúc
        // khoá hàng ở đây có cả một quãng — lưu hai bảng, và trước đó còn hỏi
        // phí ship qua mạng. Người bán sửa giá đúng trong quãng đó thì đơn chốt
        // theo giá cũ, và không ai biết: hoá đơn tự khớp với chính nó.
        //
        // Cùng cửa sổ mà task #2 đã đóng cho `stock`, chỉ khác là nó bỏ sót
        // `price`. Đo bằng TC-P2-16.
        //
        // TỪ CHỐI chứ không tự tính lại. Tính lại nghĩa là người mua bấm "Đặt
        // hàng" ở giá 100.000 rồi bị trừ 150.000 — im lặng và tệ hơn hẳn. Từ
        // chối kèm câu giải thích thì họ nhìn thấy giá mới rồi tự quyết, đúng
        // khuôn `ConflictException('Kho vừa thay đổi, mời bạn đặt lại đơn')`.
        const giaThat = new Map(daKhoa.map((p) => [p.id, Number(p.price)]));
        for (const item of orderItemsData) {
          const con = khoThat.get(item.product.id);
          if (con === undefined) {
            throw new NotFoundException(
              `Sản phẩm ID ${item.product.id} không tồn tại`,
            );
          }
          if (con < item.quantity) {
            throw new BadRequestException(
              `Sản phẩm "${item.product_name}" chỉ còn ${con} trong kho`,
            );
          }

          const giaMoi = giaThat.get(item.product.id);
          if (giaMoi !== undefined && giaMoi !== Number(item.price)) {
            throw new ConflictException(
              `Giá của "${item.product_name}" vừa thay đổi ` +
                `(${Number(item.price).toLocaleString('vi-VN')}đ → ` +
                `${giaMoi.toLocaleString('vi-VN')}đ). Mời bạn xem lại giỏ hàng ` +
                'rồi đặt lại đơn.',
            );
          }
        }

        const luuDon = await em.save(Order, order);

        await em.save(
          OrderItem,
          orderItemsData.map((item) => ({
            ...item,
            order: { id: luuDon.id },
          })) as unknown as OrderItem[],
        );

        for (const id of idTheoThuTu) {
          const soLuong = orderItemsData
            .filter((i) => i.product.id === id)
            .reduce((s, i) => s + i.quantity, 0);
          // Trừ kho và cộng `sold_count` trong CÙNG một câu UPDATE.
          //
          // `sold_count` trước đây không được cộng ở bất kỳ đâu trong repo —
          // grep toàn bộ `src` chỉ thấy nó trong `ORDER BY` lúc sắp xếp "bán
          // chạy". Tức danh sách bán chạy đang sắp xếp theo một cột luôn bằng 0.
          // Đo bằng TC-P1-10a.
          //
          // Gộp vào một câu chứ không thêm một `increment` riêng: hai câu UPDATE
          // trên cùng một dòng trong cùng transaction là hai lần ghi và hai lần
          // chờ khoá, mà chúng luôn cùng thành công hoặc cùng hỏng.
          const kq = await em
            .createQueryBuilder()
            .update(Product)
            .set({
              stock: () => 'stock - :soLuong',
              sold_count: () => 'sold_count + :soLuong',
            })
            .where('id = :id AND stock >= :soLuong', { id, soLuong })
            .execute();
          if (kq.affected !== 1) {
            // Không thể xảy ra khi khoá còn giữ. Nếu nó xảy ra thì có người vừa
            // gỡ khoá ở trên, và ném ở đây là thứ duy nhất còn chặn kho về âm.
            throw new ConflictException(
              'Kho vừa thay đổi, mời bạn đặt lại đơn',
            );
          }
        }

        await em.delete(
          Cart,
          cartItems.map((c) => c.id),
        );

        return luuDon;
      });

    // LƯỢT THỨ HAI NHẬN LẠI ĐƠN CŨ, KHÔNG NHẬN LỖI.
    //
    // Khoá UNIQUE `uq_order_idempotency` để đúng một lượt đi qua; lượt còn lại
    // nhận `ER_DUP_ENTRY` từ database và transaction của nó quay lui sạch — kho
    // không bị trừ lần hai, giỏ không bị xoá hai lần.
    //
    // Nhưng "quay lui sạch" chưa đủ tử tế: người mua bấm hai lần không làm gì
    // sai, họ không nên nhận thông báo lỗi. Nên ở đây tra lại đơn vừa được tạo
    // và trả về chính nó. Đó mới là idempotency đúng nghĩa: gọi bao nhiêu lần
    // cũng ra cùng một kết quả.
    //
    // KHÔNG SỢ TRA HỤT. MySQL cho lượt thứ hai chờ ở khoá cho tới khi lượt thứ
    // nhất commit rồi mới trả lỗi trùng. Tới lúc bắt được lỗi thì đơn kia chắc
    // chắn đã nằm trong database.
    //
    // Vì sao vẫn tra theo khoá thay vì tin rằng lỗi trùng LUÔN là do khoá này:
    // `orders` còn một khoá UNIQUE nữa (`order_code`). Tra hụt thì ném tiếp,
    // không đoán.
    let savedOrder: Order;
    try {
      savedOrder = await chayTransaction();
    } catch (err) {
      if (!laLoiTrungKhoa(err)) throw err;

      const daTao = await this.orderRepository.findOne({
        where: { idempotency_key: khoaChongTrung },
      });
      if (!daTao) throw err;

      this.logger.log(
        `Đơn trùng lượt bấm của user ${user.id} — trả lại đơn #${daTao.id} ` +
          'thay vì tạo đơn mới.',
      );
      const cu = (await this.findOne(daTao.id, user)) as Order & {
        needs_payOS?: boolean;
      };
      cu.needs_payOS =
        (payment_method ?? order.payment_method) === PaymentMethod.PAYOS;
      return cu;
    }

    // THÔNG BÁO HỎNG THÌ MẤT THÔNG BÁO, KHÔNG MẤT ĐƠN.
    //
    // Lời gọi này nằm SAU transaction và trước đây KHÔNG có try/catch. Nó đi
    // sang Firebase, mà Firebase chậm hoặc lỗi là chuyện thường.
    //
    // Lúc nó ném thì kho đã trừ, giỏ đã xoá, đơn đã lưu — nhưng người mua nhận
    // HTTP 500 và tưởng đặt hàng thất bại. Họ bấm lại, và lần này tạo đơn thứ
    // hai, trừ kho lần thứ hai. Đo bằng TC-P2-14.
    //
    // Cùng nguyên tắc với `notifyPaid` bên `payos.service.ts`: "chạy sau commit,
    // hỏng thì chỉ mất thông báo, tiền đã vào sổ rồi".
    try {
      await this.notificationsService.create({
        user_id: user.id,
        type: 'order_status' as any,
        title: 'Đặt hàng thành công',
        content: `Đơn hàng ${orderCode} đã được đặt thành công với tổng ${finalAmount.toLocaleString('vi-VN')}đ`,
        data: { order_id: savedOrder.id, order_code: orderCode },
      });
    } catch (err) {
      this.logger.warn(
        `Không gửi được thông báo đặt hàng cho đơn ${orderCode}: ` +
          `${(err as Error).message}. Đơn đã lưu thành công.`,
      );
    }

    await this.notifySellersOfNewOrder(savedOrder.id, orderCode, cartItems);

    // TỒN KHO REAL-TIME (task #26b) — phát SAU KHI transaction đã commit.
    //
    // Đặt bên trong transaction là phát một con số có thể bị quay lui ngay
    // sau đó, và người đang xem trang sẽ thấy tồn kho chưa bao giờ tồn tại.
    // Ở đây đơn đã lưu xong, kho đã trừ xong.
    //
    // `phat()` KHÔNG BAO GIỜ NÉM — xem StockEventsService. Đơn đã nằm trong
    // database rồi; hỏng việc báo không được phép hỏng việc đặt hàng.
    for (const ci of cartItems) {
      const conLai = await this.productRepository
        .findOne({ where: { id: ci.product.id }, select: { stock: true } })
        .catch(() => null);
      if (conLai) await this.stockEvents.phat(ci.product.id, conLai.stock);
    }

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
      .addSelect("DATE_FORMAT(order.created_at, '%Y-%m-%d %H:%i:%s.%f')", 'cts')
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

  /**
   * Báo cho TỪNG người bán trong đơn vừa đặt (lỗi H-02 test E2E 30/09).
   *
   * Trước đây chỉ người mua nhận thông báo: người bán không biết có đơn để xác
   * nhận, đơn nằm "Chờ xác nhận" tới khi người mua hỏi qua chat.
   * notificationsService.create tự đẩy push tới mọi thiết bị của người bán;
   * `view: 'seller'` để app mở màn Đơn bán thay vì màn đơn mua.
   *
   * Đơn ĐÃ lưu xong ở đây: thông báo hỏng thì chỉ ghi log, không ném, nếu
   * không người mua thấy "đặt hàng lỗi" cho một đơn đã tạo và đã trừ kho.
   */
  private async notifySellersOfNewOrder(
    orderId: number,
    orderCode: string,
    cartItems: Cart[],
  ): Promise<void> {
    const bySeller = new Map<number, { count: number; amount: number }>();
    for (const ci of cartItems) {
      const sellerId = ci.product?.seller?.id;
      if (!sellerId) continue;
      const g = bySeller.get(sellerId) ?? { count: 0, amount: 0 };
      g.count += ci.quantity;
      g.amount += Number(ci.product.price) * ci.quantity;
      bySeller.set(sellerId, g);
    }
    for (const [sellerId, { count, amount }] of bySeller) {
      try {
        await this.notificationsService.create({
          user_id: sellerId,
          type: 'order_status' as any,
          title: 'Bạn có đơn hàng mới',
          content: `Đơn ${orderCode}: ${count} món, ${amount.toLocaleString('vi-VN')}đ. Xác nhận để gửi hàng nhé.`,
          data: { order_id: orderId, order_code: orderCode, view: 'seller' },
        });
      } catch (err) {
        this.logger.warn(
          `Không báo được đơn mới ${orderCode} cho người bán ${sellerId}: ${(err as Error).message}`,
        );
      }
    }
  }

  async findOne(id: number, user: IUser) {
    // Người mua, admin, VÀ người bán của bất kỳ món nào trong đơn đều xem được
    // (lỗi H-02). Trước đây lọc cứng theo order.user_id nên người bán mở đơn
    // của chính mình nhận 404, app không làm được màn Đơn bán. Người không liên
    // quan vẫn nhận 404 (findOneForActor), không lộ là đơn có tồn tại.
    const { order, actors } = await this.findOneForActor(id, user);
    const sellerOnly =
      actors.length === 1 && actors[0] === OrderActor.SELLER;
    if (sellerOnly) {
      // Người bán chỉ cần biết ai nhận (đã có receiver_* trên đơn), không cần
      // email/hồ sơ tài khoản của người mua.
      order.user = {
        id: order.user?.id,
        full_name: order.user?.full_name,
      } as User;
      // Đơn nhiều người bán: chỉ trả món của chính người gọi (review 05/10).
      // Không lọc thì người bán A đọc được món, giá của người bán B cùng đơn.
      order.items = (order.items || []).filter(
        (i) => i.product?.seller?.id === user.id,
      );
    }

    // Đính kèm vận đơn theo từng người bán để giao diện hiện trạng thái giao và
    // nút "Đã nhận hàng" cho đúng người bán. OrderShipment là bảng riêng (mirror
    // (order, seller)), không phải quan hệ trên Order — nên tra riêng rồi gắn.
    const shipments = await this.shipmentRepository.find({
      where: { order: { id } },
      relations: ['seller'],
    });
    // Như món ở trên: người bán chỉ thấy vận đơn của mình, không thấy mã vận
    // đơn và tiền thu hộ (cod_amount) của người bán khác.
    (order as any).shipments = sellerOnly
      ? shipments.filter((s) => s.seller?.id === user.id)
      : shipments;

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

    // ĐÁNH DẤU ĐÃ TRẢ TIỀN TRƯỚC, TÁCH KHOẢN KÝ QUỸ SAU — không đảo ngược.
    //
    // Thứ tự cũ gọi `createOrderEscrows` rồi mới đặt `is_paid`, nên lúc hàm đó
    // chạy thì database vẫn ghi đơn là CHƯA trả tiền. Nay `createOrderEscrows`
    // từ chối đúng trường hợp ấy (xem lời giải thích trong `escrows.service.ts`),
    // nên phải lưu cờ xuống trước.
    const vuaDanhDauDaTra = updateOrderDto.is_paid === true && !order.is_paid;
    if (vuaDanhDauDaTra) {
      order.is_paid = true;
      order.paid_at = new Date();
    }

    if (nextStatus) {
      order.status = nextStatus;
    }

    await this.orderRepository.save(order);

    if (vuaDanhDauDaTra) {
      // Đường THỦ CÔNG: admin khẳng định tiền đã về (chủ yếu là đơn COD do
      // GHN thu hộ). Không có webhook nào đưa tiền vào két nên phải ghi bút
      // toán đó ở đây, nếu không lần giải ngân đầu tiên kéo escrow_hold xuống
      // âm. Xem lời giải thích đầy đủ trong escrows.service.ts.
      await this.escrowsService.createOrderEscrowsWithExternalFunding(order.id);
    }

    // Tiền đi sau khi trạng thái đã lưu. Lỗi ở đây được NÉM RA, không nuốt:
    // trước đây `catch { console.error }` khiến API trả 200 trong khi tiền
    // không hề chuyển, và không ai biết cho tới lúc đối soát.
    if (nextStatus === OrderStatus.DELIVERED) {
      await this.releaseEscrowOrExplain(order.id, 'giải ngân');
    }
    // HOÀN TIỀN THÌ HÀNG CŨNG PHẢI VỀ KHO.
    //
    // `cancel()` hoàn kho, còn nhánh này thì không — hai đường cùng nghĩa "giao
    // dịch không thành" mà chỉ một đường trả hàng lại. Đơn hoàn tiền để lại
    // hàng bị trừ vĩnh viễn: người bán mất chỗ trên kệ mà không ai lấy hàng đi.
    // Đo bằng TC-P1-07.
    //
    // Tiền và kho trong CÙNG một transaction: hoàn tiền hỏng (người bán đã tiêu
    // hết số đã nhận) thì kho cũng không được cộng lại, nếu không thì kho phình
    // ra hàng không có thật mà tiền vẫn chưa trả người mua.
    if (nextStatus === OrderStatus.REFUNDED) {
      await this.dataSource.transaction(async (em) => {
        try {
          await this.escrowsService.refund(order.id, em, true);
        } catch (err) {
          // CHỈ nuốt đúng một trường hợp, y như `applyCancellation` đã làm:
          // đơn không có khoản ký quỹ nào để hoàn (đơn COD, hoặc đơn có từ
          // trước khi hệ thống ký quỹ tồn tại). Hàng vẫn phải về kho — việc trừ
          // kho xảy ra lúc đặt đơn, không phụ thuộc vào việc tiền đi đường nào.
          //
          // Mọi lỗi khác phải làm hỏng cả transaction: tiền chưa về mà kho đã
          // cộng lại thì sàn vừa mất hàng lẫn tiền.
          if (!(err instanceof NotFoundException)) throw err;
          this.logger.warn(
            `Đơn #${order.id} hoàn tiền nhưng không có khoản ký quỹ nào. ` +
              'Vẫn trả hàng về kho, nhưng cần đối soát tay xem tiền ở đâu.',
          );
        }
        for (const item of order.items ?? []) {
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

    // ĐƠN CHƯA THANH TOÁN THÌ KHÔNG CÓ GÌ ĐỂ NHẢ.
    //
    // Hàm này kiểm đủ thứ — ai gọi, lô có tồn tại, lô đã nhận chưa, lô có hỏng
    // không — nhưng tới 24/09 nó KHÔNG hỏi đơn đã trả tiền chưa. Mà dòng
    // `escrowsService.release()` ngay dưới là lệnh chuyển tiền cho người bán.
    //
    // Ghép với BUG-02 (ký quỹ sinh ra lúc tạo link, chưa ai trả đồng nào) thì
    // đây là nút bấm cuối của một chuỗi ba bước lấy hàng miễn phí, chỉ cần một
    // tài khoản người mua bình thường:
    //
    //   POST /payos/create-link          -> ký quỹ holding, chưa trả tiền
    //   PATCH /payments/:id {success}    -> orders.is_paid = 1, sổ cái trống
    //   PATCH .../shipments/:id/received -> ví người bán +N, escrow_hold -N
    //
    // BUG-01 và BUG-02 đã vá, nên chuỗi đó đã đứt ở hai chỗ. Lớp này là chỗ thứ
    // ba, cố ý chồng lên: chừng nào còn đường nào tạo được ký quỹ cho đơn chưa
    // trả tiền thì nó vẫn phải chặn ở đây.
    //
    // Đo được bằng TC-P3-20.
    if (!order.is_paid) {
      throw new BadRequestException(
        'Đơn hàng chưa được thanh toán nên chưa thể xác nhận đã nhận hàng. ' +
          'Với đơn COD, người bán hoặc quản trị viên cần ghi nhận đã thu tiền trước.',
      );
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
   * SANDBOX: gia lap GHN day trang thai van don (GHN dev khong co shipper that).
   * Chi chay tren host GHN dev. phase "shipping" = GHN da lay hang/dang giao ->
   * don sang "Dang giao" (KHONG do nguoi ban bam). phase "delivered" = GHN giao
   * toi cua -> danh dau van don DELIVERED (nguoi mua xac nhan / he thong tu chot).
   */
  async simulateGhnStatus(
    orderId: number,
    phase: "shipping" | "delivered",
    user: IUser,
  ) {
    const ghnHost = (process["env"]["GHN_HOST"] as string) ?? "";
    if (!ghnHost.includes("dev-online-gateway")) {
      throw new BadRequestException("Gia lap GHN chi dung o moi truong sandbox");
    }
    const { order, actors } = await this.findOneForActor(orderId, user);
    if (
      !actors.includes(OrderActor.SELLER) &&
      !actors.includes(OrderActor.ADMIN)
    ) {
      throw new ForbiddenException(
        "Chi nguoi ban cua don hoac admin moi gia lap GHN",
      );
    }

    if (phase === "shipping") {
      if (
        order.status !== OrderStatus.CONFIRMED &&
        order.status !== OrderStatus.PROCESSING
      ) {
        throw new BadRequestException(
          "Chi gia lap dang giao cho don da xac nhan hoac dang chuan bi",
        );
      }
      // GHN chỉ "đang giao" được lô hàng nó đã nhận vận đơn. Trước đây nhánh
      // này đẩy đơn sang shipping kể cả khi vận đơn FAILED (lỗi H-08, đơn
      // ORD-20260930-785): app hiện "Đang giao", người mua bấm "Đã nhận hàng"
      // thì bị từ chối, đơn kẹt ở đó. Mọi người bán trong đơn phải có vận đơn.
      await this.assertAllSellersShipped(order);
      order.status = OrderStatus.SHIPPING;
      await this.orderRepository.save(order);
      return { order_id: order.id, status: order.status };
    }

    const shipments = await this.shipmentRepository.find({
      where: { order: { id: orderId } },
    });
    const now = new Date();
    for (const s of shipments) {
      if (s.status === ShipmentStatus.CREATED) {
        s.status = ShipmentStatus.DELIVERED;
        s.delivered_at = now;
        await this.shipmentRepository.save(s);
      }
    }
    return { order_id: order.id, delivered_shipments: shipments.length };
  }


  /**
   * Mỗi người bán trong đơn phải có một vận đơn GHN không FAILED. Thiếu hay
   * lỗi thì ném 400 kèm lý do GHN, để người bán biết phải sửa gì.
   */
  private async assertAllSellersShipped(order: Order): Promise<void> {
    const sellerIds = new Set(
      (order.items || [])
        .map((i) => i.product?.seller?.id)
        .filter((id): id is number => !!id),
    );
    const shipments = await this.shipmentRepository.find({
      where: { order: { id: order.id } },
      relations: ['seller'],
    });
    const missing = [...sellerIds].filter(
      (id) =>
        !shipments.some(
          (s) => s.seller?.id === id && s.status !== ShipmentStatus.FAILED,
        ),
    );
    if (sellerIds.size === 0 || missing.length > 0) {
      const reason = shipments.find(
        (s) => s.status === ShipmentStatus.FAILED && s.error,
      )?.error;
      throw new BadRequestException(
        'Đơn chưa có vận đơn GHN hợp lệ nên chưa thể chuyển sang đang giao' +
          (reason ? ` (${reason})` : '') +
          '. Người bán tạo lại vận đơn trước.',
      );
    }
  }

  /**
   * Tạo lại vận đơn GHN cho những người bán mà lần trước GHN từ chối.
   *
   * Entity OrderShipment ghi FAILED là trạng thái "cho phép tạo lại", nhưng
   * trước đây không có đường nào làm việc đó: xác nhận đơn chỉ xảy ra một lần,
   * và lần tạo sau coi dòng FAILED như đã có vận đơn. Người bán sửa địa chỉ
   * lấy hàng xong vẫn kẹt (lỗi H-07/H-08).
   */
  async retryGhnShipments(orderId: number, user: IUser) {
    const { order, actors } = await this.findOneForActor(orderId, user);
    if (
      !actors.includes(OrderActor.SELLER) &&
      !actors.includes(OrderActor.ADMIN)
    ) {
      throw new ForbiddenException(
        'Chỉ người bán của đơn hoặc admin mới tạo lại được vận đơn',
      );
    }
    if (
      order.status !== OrderStatus.CONFIRMED &&
      order.status !== OrderStatus.PROCESSING
    ) {
      throw new BadRequestException(
        'Chỉ tạo lại vận đơn cho đơn đã xác nhận, chưa giao',
      );
    }
    if (!order.ghn_district_id) {
      throw new BadRequestException(
        'Đơn này không dùng địa chỉ GHN nên không tạo được vận đơn',
      );
    }
    await this.createGhnShipmentsPerSeller(order);
    // createGhnShipmentsPerSeller có thể điền order.tracking_code (UI cũ đọc).
    await this.orderRepository.save(order);
    return this.shipmentRepository.find({
      where: { order: { id: orderId } },
      relations: ['seller'],
    });
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
   * error, các người bán khác vẫn có phí. `ok = false` khi có ít nhất một phần
   * lỗi: số 0 đó nghĩa là "chưa biết", KHÔNG phải "miễn phí", client phải hiện
   * lỗi thay vì chữ "Miễn phí" (lỗi H-07).
   */
  private async quoteShippingBySellerFromCart(
    cartItems: Cart[],
    toDistrictId: number,
    toWardCode: string,
  ): Promise<{
    ok: boolean;
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
        error = ghnErrorMessage(e);
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
    return { ok: items.every((i) => !i.error), total, items };
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
   *    Riêng dòng FAILED thì THỬ LẠI và cập nhật chính dòng đó (xem
   *    retryGhnShipments), không sinh dòng thứ hai cho cùng người bán.
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
    const existingBySeller = new Map(existing.map((s) => [s.seller?.id, s]));

    // Địa chỉ lấy hàng của các người bán, tra một lần.
    const shops = await this.shopRepository.find({
      where: { user: { id: In(sellerIds) } },
      relations: ['user'],
    });
    const shopByUser = new Map(shops.map((s) => [s.user.id, s]));

    const isCod = order.payment_method === PaymentMethod.COD;

    for (const [sellerId, { seller, items }] of bySeller) {
      const previous = existingBySeller.get(sellerId);
      if (previous && previous.status !== ShipmentStatus.FAILED) continue;

      // Chốt dòng FAILED TRƯỚC khi gọi GHN (review 30/09). Hai yêu cầu tạo lại
      // cùng lúc (bấm đúp) đều đọc thấy dòng FAILED; không chốt thì cả hai gọi
      // GHN và GHN tạo HAI vận đơn thật cho một lô hàng, một cái mồ côi mà vẫn
      // đi lấy hàng, thu hộ. UPDATE có điều kiện trên `error` vừa đọc chỉ đổi
      // được dòng cho một yêu cầu (InnoDB khoá dòng, yêu cầu sau thấy error đã
      // khác): nó được đi tiếp, yêu cầu kia nhận affected = 0 và bỏ qua.
      // Sập giữa chừng thì dòng vẫn FAILED với error là mã chốt, lần tạo lại
      // sau chốt lại được bình thường.
      if (previous) {
        const claim = `Đang tạo lại vận đơn (${randomUUID()})`;
        const res = await this.shipmentRepository.update(
          {
            id: previous.id,
            status: ShipmentStatus.FAILED,
            error: previous.error ?? IsNull(),
          },
          { error: claim },
        );
        if (!res.affected) continue;
        previous.error = claim;
      }

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
          // Cố định theo (đơn, người bán): timeout phía GHN không có nghĩa là
          // chưa tạo (test máy ảo 05/10: request "vẫn đang xử lý" sau timeout).
          // Tạo lại với cùng mã thì GHN trả vận đơn cũ, không sinh vận đơn trùng.
          client_order_code: `${order.order_code}-${sellerId}`,
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
        // GhnService trả `any` (body GHN); chốt kiểu một lần ở đây.
        const trackingCode = (ghnOrder as { order_code: string }).order_code;

        await this.shipmentRepository.save(
          previous
            ? Object.assign(previous, {
                tracking_code: trackingCode,
                cod_amount: codAmount,
                status: ShipmentStatus.CREATED,
                error: null,
              })
            : this.shipmentRepository.create({
                order: { id: order.id } as Order,
                seller: { id: sellerId } as User,
                tracking_code: trackingCode,
                cod_amount: codAmount,
                status: ShipmentStatus.CREATED,
              }),
        );

        // Giữ tương thích: UI cũ đọc order.tracking_code. Đơn một người bán vẫn
        // thấy mã như trước; đơn nhiều người bán lấy mã đầu tiên làm đại diện.
        if (!order.tracking_code) order.tracking_code = trackingCode;
      } catch (err) {
        const message = ghnErrorMessage(err);
        this.logger.error(
          `Tạo vận đơn GHN thất bại cho người bán ${sellerId} (đơn ${order.id}): ${message}`,
        );
        await this.shipmentRepository.save(
          previous
            ? Object.assign(previous, { cod_amount: codAmount, error: message })
            : this.shipmentRepository.create({
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

  /**
   * Giải ngân, và nếu hỏng thì nói rõ hỏng ở đâu.
   *
   * Chỉ còn phục vụ nhánh `delivered`. Nhánh `refunded` trước đây cũng đi qua
   * đây, nhưng nó cần thêm việc hoàn kho trong cùng transaction nên đã tách ra
   * chỗ gọi riêng ở `updateStatus`.
   */
  private async releaseEscrowOrExplain(
    orderId: number,
    action: 'giải ngân',
  ): Promise<void> {
    try {
      await this.escrowsService.release(orderId);
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
    // Gom id san pham da hoan kho, de phat SAU khi transaction commit.
    const daHoan: number[] = [];
    await this.dataSource.transaction(async (em: EntityManager) => {
      // KHOÁ DÒNG ĐƠN TRƯỚC MỌI THỨ, RỒI ĐỌC LẠI TRẠNG THÁI TỪ DATABASE.
      //
      // Task #2 bảng phân công. `assertCancellable` phía trên có kiểm trạng
      // thái, nhưng nó kiểm trên đối tượng đã nạp từ TRƯỚC — hai lượt huỷ đồng
      // thời đều đọc thấy "pending", đều qua cửa, rồi đều cộng hàng về kho.
      //
      // Đo được bằng `npm run check:race` R4: huỷ 20 lượt cùng lúc thì kho về
      // 20 trong khi đơn chỉ có 1 món. Không mất tiền, nhưng kho phình ra hàng
      // không có thật và người sau đặt được món đã hết.
      //
      // `pessimistic_write` sinh `SELECT ... FOR UPDATE`: lượt thứ hai phải chờ
      // lượt thứ nhất commit xong mới đọc, và lúc đó nó thấy 'cancelled'.
      const chot = await em.findOne(Order, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!chot) return;

      // Đã có người huỷ trước → không làm gì. KHÔNG ném lỗi: đây là đường mà
      // cron huỷ đơn quá hạn cũng đi qua, và một cron chạy lại phải vô hại.
      if (chot.status === OrderStatus.CANCELLED) return;

      // Trạng thái có thể đã đổi sang thứ khác trong lúc chờ khoá (người bán
      // vừa bấm giao hàng chẳng hạn). Lúc đó huỷ là sai, phải dừng hẳn.
      if (
        chot.status !== OrderStatus.PENDING &&
        chot.status !== OrderStatus.CONFIRMED
      ) {
        throw new BadRequestException(
          'Đơn hàng vừa đổi trạng thái, không huỷ được nữa',
        );
      }

      // Đọc `is_paid` từ bản vừa khoá, không dùng bản nạp từ trước: tiền có thể
      // vừa về trong lúc chờ.
      order.is_paid = chot.is_paid;

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

      // `update` chứ không `save(order)`: `order` là đối tượng nạp từ trước khi
      // có khoá, lưu cả nó là ghi đè bằng dữ liệu có thể đã cũ. Chỉ đổi đúng
      // một cột mình vừa quyết định.
      await em.update(
        Order,
        { id: order.id },
        { status: OrderStatus.CANCELLED },
      );
      order.status = OrderStatus.CANCELLED;

      // KHÔNG CỘNG LẠI KHO CHO MÓN NGƯỜI MUA ĐÃ CẦM TRONG TAY.
      //
      // Sàn C2C nhiều shop: người mua xác nhận nhận hàng của shop A (ký quỹ của
      // A chuyển sang `released`, hàng đã tới nhà họ), rồi huỷ đơn vì shop B
      // chưa giao. `applyCancellation` cộng lại kho cho CẢ món của A — món đang
      // nằm ở nhà người mua. Kho phình ra một món không có thật, và người sau
      // đặt được thứ không tồn tại. Đo bằng TC-P1-09b.
      //
      // Quy tắc: ký quỹ của người bán nào đã `released` thì hàng của người đó
      // coi như đã giao xong, không hoàn kho. Phần tiền cũng không bị `refund()`
      // đụng tới vì nó chỉ tìm khoản `holding` — hai vế khớp nhau.
      const daGiaiNgan = new Set(
        (
          await em.find(Escrow, {
            where: { order: { id: order.id } },
            relations: ['seller'],
          })
        )
          .filter((e) => e.status === EscrowStatus.RELEASED)
          .map((e) => e.seller?.id)
          .filter((id): id is number => id !== undefined),
      );

      for (const item of order.items) {
        if (!item.product) continue;

        const sellerId = item.product.seller?.id;
        if (sellerId !== undefined && daGiaiNgan.has(sellerId)) {
          this.logger.log(
            `Đơn #${order.id}: không hoàn kho sản phẩm ${item.product.id} — ` +
              `người bán ${sellerId} đã giao xong và đã được giải ngân.`,
          );
          continue;
        }

        await em.increment(
          Product,
          { id: item.product.id },
          'stock',
          item.quantity,
        );
        // Nhớ lại để phát SAU khi transaction commit — xem dưới.
        daHoan.push(item.product.id);
      }
    });

    // TỒN KHO REAL-TIME (task #26b) — phát SAU KHI transaction đã commit.
    //
    // Đây là chỗ DUY NHẤT trong ba chỗ phát mà `worker` cũng chạy:
    // `cancelExpired` gọi xuống đây mỗi giờ. Worker KHÔNG có socket server,
    // nên `server.emit` ở đây là gọi vào `undefined` — chính lý do cả cơ chế
    // phải đi qua Redis pub/sub.
    for (const productId of daHoan) {
      const p = await this.productRepository
        .findOne({ where: { id: productId }, select: { stock: true } })
        .catch(() => null);
      if (p) await this.stockEvents.phat(productId, p.stock);
    }
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

  /**
   * Đơn mà người gọi là NGƯỜI MUA (hoặc admin). Dùng cho thao tác của người mua.
   *
   * Tách khỏi findOne vì findOne giờ cho cả người bán XEM (lỗi H-02). cancel()
   * và remove() từng mượn findOne để kiểm quyền; giữ nguyên thì người bán gọi
   * được đường huỷ của người mua và xoá mềm được đơn. Người bán huỷ qua
   * cancelSale, có luật riêng.
   */
  private async findOneAsBuyerOrAdmin(id: number, user: IUser) {
    const { order, actors } = await this.findOneForActor(id, user);
    if (
      !actors.includes(OrderActor.BUYER) &&
      !actors.includes(OrderActor.ADMIN)
    ) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    return order;
  }

  async cancel(id: number, user: IUser) {
    const order = await this.findOneAsBuyerOrAdmin(id, user);
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

  /**
   * Xoá mềm một đơn. **Chỉ đơn đã kết thúc, và tiền phải đã yên chỗ.**
   *
   * Tới 24/09 hàm này chỉ gọi `findOne(id, user)` — mà người mua là chủ đơn nên
   * qua được — rồi `softDelete` thẳng. Không kiểm trạng thái, không hoàn kho,
   * không đụng tới ký quỹ.
   *
   * Nghĩa là người mua xoá được một đơn ĐANG GIAO, ĐÃ TRẢ TIỀN. Đơn biến mất
   * khỏi danh sách của cả người bán (soft-delete lọc ở tầng repository), trong
   * khi hàng vẫn đang trừ kho và tiền vẫn nằm trong `escrow_hold` — không ai
   * còn đường nào tìm thấy nó để giải ngân hay hoàn lại.
   *
   * Đo được bằng TC-P1-08.
   *
   * Vì sao KHÔNG hoàn kho ở đây: xoá là thao tác dọn danh sách, không phải
   * thao tác nghiệp vụ. Muốn trả hàng về kho thì phải đi qua `/cancel` hoặc
   * `/cancel-sale` — hai chỗ đó hoàn kho, hoàn ký quỹ và đóng link thanh toán
   * trong một transaction. Ở đây chỉ chặn, không tự làm thay.
   */
  async remove(id: number, user: IUser) {
    // CHỈ NGƯỜI MUA HOẶC ADMIN. Người bán thì nhận 404 như người ngoài.
    //
    // Trước lần gộp 07/10, chỗ này gọi `findOne(id, user)` và comment cũ của
    // vai B viết: "đã qua findOne nên chắc chắn là người mua của đơn hoặc
    // admin". Câu đó ĐÃ CHẾT: nhánh của Đạt mở `findOne` cho NGƯỜI BÁN xem đơn
    // (H-02). Người bán đi lọt qua đó, rơi xuống phép kiểm trạng thái bên dưới
    // và nhận "đơn đang pending nên chưa xoá được" — tức hệ thống mách rằng cứ
    // đợi đơn kết thúc là xoá được đơn của người khác.
    //
    // Không bên nào tự thấy được: Đạt mở quyền xem mà không biết có hàm dựa vào
    // giả định cũ; vai B viết giả định đúng tại thời điểm viết. Nó chỉ lộ ra khi
    // bài kiểm `seller-orders.spec.ts` của Đạt chạy trên mã của vai B.
    //
    // Bài học giữ lại: đừng suy quyền từ việc "đã qua được hàm đọc". Hàm đọc có
    // thể được nới rộng bởi người khác, ở nhánh khác, vì lý do chính đáng.
    const { order, actors } = await this.findOneForActor(id, user);
    if (
      !actors.includes(OrderActor.ADMIN) &&
      !actors.includes(OrderActor.BUYER)
    ) {
      // 404 chứ không 403: người bán không cần biết đơn này có tồn tại hay
      // không — cùng lý do với `findOneForActor`.
      throw new NotFoundException(`Không tìm thấy đơn hàng #${id}`);
    }

    const daKetThuc =
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.DELIVERED ||
      order.status === OrderStatus.REFUNDED;

    if (!daKetThuc) {
      throw new BadRequestException(
        `Đơn hàng đang ở trạng thái "${order.status}" nên chưa xoá được. ` +
          'Huỷ đơn bằng /cancel (người mua) hoặc /cancel-sale (người bán) — ' +
          'hai đường đó còn hoàn lại tồn kho và tiền ký quỹ.',
      );
    }

    // Còn khoản ký quỹ đang giữ thì tiền chưa đi đâu cả. Xoá đơn lúc này là
    // chôn luôn manh mối duy nhất dẫn tới số tiền đó.
    // Truyền `user` xuống: từ 25/09 `findByOrder` kiểm quyền (BUG-18). Người
    // gọi ở đây đã qua `findOne(id, user)` nên chắc chắn là người mua của đơn
    // hoặc admin — cả hai đều đủ quyền xem ký quỹ của chính đơn đó.
    const conGiuTien = await this.escrowsService.findByOrder(id, user);
    if (conGiuTien.some((e) => e.status === EscrowStatus.HOLDING)) {
      throw new BadRequestException(
        'Đơn hàng còn khoản ký quỹ đang giữ, chưa xoá được. Cần giải ngân ' +
          'hoặc hoàn tiền xong trước.',
      );
    }

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

    // MỘT NGƯỜI BÁN KHÔNG ĐƯỢC HUỶ PHẦN CỦA NGƯỜI BÁN KHÁC.
    //
    // `cancelSale` nhận `user.id` chỉ để KIỂM QUYỀN, rồi gọi thẳng
    // `applyCancellation(order)` — hàm đó huỷ cả đơn, hoàn kho MỌI món và
    // refund MỌI khoản ký quỹ đang giữ. Nên shop A bấm "huỷ bán" phần của mình
    // là huỷ luôn phần của shop B, trong khi B chưa làm gì sai và có thể đã
    // đóng gói xong. Đo bằng TC-P1-09a.
    //
    // VÌ SAO CHẶN CHỨ KHÔNG HUỶ TỪNG PHẦN. Huỷ đúng phần của một người bán cần
    // trạng thái huỷ ở mức TỪNG MÓN — `order_items` hiện không có cột nào như
    // vậy, và `orders.status` thì chỉ có một giá trị cho cả đơn. Thêm trạng
    // thái đó là đổi lược đồ, đổi cách tính `final_amount`, đổi cả cách hiển
    // thị đơn ở ba client. Không làm nửa vời ở đây.
    //
    // Nợ kỹ thuật, nói thẳng: người bán trong đơn nhiều shop phải nhờ admin
    // hoặc nhờ người mua tự huỷ. Gỡ nợ này khi `order_items` có trạng thái
    // riêng — lúc đó đường huỷ theo từng người bán mới có chỗ để ghi kết quả.
    const soNguoiBan = new Set(
      (order.items ?? [])
        .map((item) => item.product?.seller?.id)
        .filter((id): id is number => id !== undefined),
    ).size;

    if (soNguoiBan > 1) {
      throw new BadRequestException(
        'Đơn hàng này có hàng của nhiều người bán nên bạn không tự huỷ được — ' +
          'huỷ sẽ ảnh hưởng tới phần của người bán khác. Liên hệ quản trị viên, ' +
          'hoặc đề nghị người mua huỷ đơn.',
      );
    }

    // Dùng chung đúng một đường huỷ với `cancel()`. Trước đây hai hàm này là
    // hai bản chép tay của cùng một việc, thứ tự các bước còn khác nhau — nên
    // sửa một chỗ là bỏ sót chỗ kia.
    await this.applyCancellation(order);
    await this.voidOpenPaymentLink(order.id);

    return { message: 'Hủy bán thành công', order_id: order.id };
  }
}
