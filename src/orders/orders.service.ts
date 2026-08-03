import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Order, OrderStatus } from './entities/order.entity';
import { PaymentMethod } from '../common/enums/payment.enum';
import { OrderItem } from './entities/order-item.entity';
import { Cart } from 'src/carts/entities/cart.entity';
import { Product } from 'src/products/entities/product.entity';
import { User } from 'src/users/entities/user.entity';
import { Repository, In } from 'typeorm';
import { IUser } from 'src/users/users.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { GhnService } from 'src/ghn/ghn.service';
import { EscrowsService } from '../escrows/escrows.service';

@Injectable()
export class OrdersService {
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
  ) { }

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
    const { shipping_address, receiver_name, receiver_phone, province, district, note, payment_method, cart_item_ids } = createOrderDto;

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
        throw new BadRequestException(`Một số sản phẩm trong giỏ hàng không tồn tại: ${missing.join(', ')}`);
      }
    }

    let totalAmount = 0;
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
        throw new NotFoundException(`Sản phẩm ID ${cartItem.product.id} không tồn tại`);
      }

      if (product.seller?.id === user.id) {
        throw new BadRequestException(`Bạn không thể mua sản phẩm "${product.name}" của chính mình`);
      }

      if (product.stock < cartItem.quantity) {
        throw new BadRequestException(`Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho`);
      }

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
      await this.productRepository.decrement({ id: item.product.id }, 'stock', item.quantity);
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

  async findAll(currentPage: string, limit: string, status: string, user: IUser, viewAs?: string) {
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
    const ids = idsRaw.map((r) => Number(r.order_id)).filter((n) => !isNaN(n));

    let result: any[] = [];
    let totalItems = ids.length;

    if (ids.length > 0) {
      result = await this.orderRepository.find({
        where: { id: In(ids) },
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

  async updateStatus(id: number, updateOrderDto: UpdateOrderDto, user: IUser) {
    const order = await this.findOne(id, user);

    if (updateOrderDto.status) {
      // Nếu xác nhận đơn và chưa có tracking_code → tạo GHN
      if (updateOrderDto.status === OrderStatus.CONFIRMED && !order.tracking_code && order.ghn_district_id) {
        try {
          const ghnOrder = await this.ghnService.createOrder({
            to_name: order.receiver_name,
            to_phone: order.receiver_phone,
            to_address: order.shipping_address,
            to_ward_code: order.ghn_ward_code,
            to_district_id: order.ghn_district_id,
            weight: 500,
            cod_amount: order.payment_method === 'cod' ? Number(order.final_amount) : 0,
            items: order.items.map(item => ({
              name: item.product_name,
              quantity: item.quantity,
              weight: 200,
              price: item.price,
            })),
          });
          order.tracking_code = ghnOrder.order_code;
        } catch (err) {
          // Nếu GHN lỗi (do chưa có token) thì vẫn xác nhận đơn, chỉ không có tracking
          console.error('GHN createOrder failed:', err.message);
        }
      }
      order.status = updateOrderDto.status;
    }

    if (updateOrderDto.status) {
      // Nếu xác nhận đơn và chưa có tracking_code → tạo GHN
      if (updateOrderDto.status === OrderStatus.CONFIRMED && !order.tracking_code && order.ghn_district_id) {
        try {
          const ghnOrder = await this.ghnService.createOrder({
            to_name: order.receiver_name,
            to_phone: order.receiver_phone,
            to_address: order.shipping_address,
            to_ward_code: order.ghn_ward_code,
            to_district_id: order.ghn_district_id,
            weight: 500,
            cod_amount: order.payment_method === 'cod' ? Number(order.final_amount) : 0,
            items: order.items.map(item => ({
              name: item.product_name,
              quantity: item.quantity,
              weight: 200,
              price: item.price,
            })),
          });
          order.tracking_code = ghnOrder.order_code;
        } catch (err) {
          console.error('GHN createOrder failed:', err.message);
        }
      }

      // Tạo escrow khi order được đánh dấu là đã thanh toán (PAID)
      if (updateOrderDto.is_paid === true && !order.is_paid) {
        try {
          await this.escrowsService.createOrderEscrows(order.id);
          order.is_paid = true;
          order.paid_at = new Date();
        } catch (err) {
          console.error('Escrow creation failed:', err.message);
        }
      }

      // Giải ngân khi giao hàng thành công
      if (updateOrderDto.status === OrderStatus.DELIVERED) {
        try {
          await this.escrowsService.release(order.id);
        } catch (err) {
          console.error('Escrow release failed:', err.message);
        }
      }

      // Hoàn tiền khi hủy hoặc refund
      if (updateOrderDto.status === OrderStatus.CANCELLED || updateOrderDto.status === OrderStatus.REFUNDED) {
        try {
          await this.escrowsService.refund(order.id);
        } catch (err) {
          console.error('Escrow refund failed:', err.message);
        }
      }

      order.status = updateOrderDto.status;
    }
  }

  async cancel(id: number, user: IUser) {
    const order = await this.findOne(id, user);

    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException('Chỉ có thể hủy đơn hàng ở trạng thái Chờ xác nhận hoặc Đã xác nhận');
    }

    order.status = OrderStatus.CANCELLED;
    // Hoàn tiền escrow nếu đã thanh toán
    if (order.is_paid) {
      try {
        await this.escrowsService.refund(order.id);
      } catch (err) {
        console.error('Escrow refund on cancel failed:', err.message);
      }
    }
    await this.orderRepository.save(order);

    for (const item of order.items) {
      if (item.product) {
        await this.productRepository.increment({ id: item.product.id }, 'stock', item.quantity);
      }
    }

    return this.findOne(id, user);
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
      throw new ForbiddenException('Bạn không phải người bán trong đơn hàng này');
    }

    return order;
  }

  async cancelSale(orderId: number, user: IUser) {
    const order = await this.findOneForSeller(orderId, user.id);

    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException(
        'Chỉ có thể hủy bán đơn hàng ở trạng thái Chờ xác nhận hoặc Đã xác nhận',
      );
    }

    order.status = OrderStatus.CANCELLED;
    await this.orderRepository.save(order);

    // Restore stock
    for (const item of order.items) {
      if (item.product) {
        await this.productRepository.increment(
          { id: item.product.id },
          'stock',
          item.quantity,
        );
      }
    }

    // Refund escrow if paid
    if (order.is_paid) {
      try {
        await this.escrowsService.refund(order.id);
      } catch (err) {
        console.error('Hoàn tiền ký quỹ cho giao dịch bị hủy không thành công:', err.message);
      }
    }

    return { message: 'Hủy bán thành công', order_id: order.id };
  }
}
