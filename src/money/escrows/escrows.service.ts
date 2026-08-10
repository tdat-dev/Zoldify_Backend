import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Escrow, EscrowStatus } from './entities/escrow.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { EntityManager, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';

@Injectable()
export class EscrowsService {
  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepository: Repository<Escrow>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}
  /**
   * Tách tiền của đơn thành từng khoản ký quỹ, mỗi người bán một khoản.
   *
   * Nhận `manager` để chạy được bên trong transaction của người gọi — webhook
   * PayOS cần việc cộng tiền, đổi trạng thái đơn và tạo ký quỹ cùng thành
   * công hoặc cùng huỷ. Không truyền thì tự dùng repository như cũ.
   */
  async createOrderEscrows(orderId: number, manager?: EntityManager) {
    const orderRepo = manager
      ? manager.getRepository(Order)
      : this.orderRepository;
    const escrowRepo = manager
      ? manager.getRepository(Escrow)
      : this.escrowRepository;

    const order = await orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.seller', 'user'],
    });

    if (!order) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }

    // Đã tách rồi thì thôi. Không có dòng này, một lần gọi lại sẽ nhân đôi
    // số khoản ký quỹ của cùng một đơn.
    const already = await escrowRepo.count({
      where: { order: { id: orderId } },
    });
    if (already > 0) {
      return escrowRepo.find({ where: { order: { id: orderId } } });
    }

    const sellerMap = new Map<number, { seller: User; total: number }>();
    for (const item of order.items) {
      const sellerId = item.product.seller.id;
      if (!sellerMap.has(sellerId)) {
        sellerMap.set(sellerId, { seller: item.product.seller, total: 0 });
      }
      sellerMap.get(sellerId)!.total += Number(item.subtotal);
    }

    const escrows: Escrow[] = [];
    for (const [, entry] of sellerMap) {
      const escrow = escrowRepo.create({
        order: { id: order.id },
        buyer: { id: order.user.id },
        seller: { id: entry.seller.id },
        amount: entry.total,
        status: EscrowStatus.HOLDING,
      });
      escrows.push(escrow);
    }

    return escrowRepo.save(escrows);
  }

  async release(orderId: number) {
    const escrows = await this.escrowRepository.find({
      where: { order: { id: orderId }, status: EscrowStatus.HOLDING },
      relations: ['seller'],
    });

    if (!escrows.length) {
      throw new NotFoundException('Không tìm thấy escrow nào để giải ngân');
    }

    for (const escrow of escrows) {
      escrow.status = EscrowStatus.RELEASED;
      escrow.released_at = new Date();
      await this.userRepository.increment(
        { id: escrow.seller.id },
        'balance',
        Number(escrow.amount),
      );
    }

    return this.escrowRepository.save(escrows);
  }

  async refund(orderId: number) {
    const escrows = await this.escrowRepository.find({
      where: { order: { id: orderId }, status: EscrowStatus.HOLDING },
      relations: ['buyer'],
    });

    if (!escrows.length) {
      throw new NotFoundException('Không tìm thấy escrow nào để hoàn tiền');
    }

    for (const escrow of escrows) {
      escrow.status = EscrowStatus.REFUNDED;
      await this.userRepository.increment(
        { id: escrow.buyer.id },
        'balance',
        Number(escrow.amount),
      );
    }

    return this.escrowRepository.save(escrows);
  }

  async findByOrder(orderId: number) {
    return this.escrowRepository.find({
      where: { order: { id: orderId } },
      relations: ['buyer', 'seller'],
    });
  }

  async findBySeller(
    sellerId: number,
    page: number,
    limit: number,
    status?: string,
  ) {
    const where: any = { seller: { id: sellerId } };
    if (status) where.status = status;

    const [result, total] = await this.escrowRepository.findAndCount({
      where,
      relations: ['order', 'buyer'],
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result,
    };
  }

  async findAll(page: number, limit: number, status?: string) {
    const where: any = {};
    if (status) where.status = status;

    const [result, total] = await this.escrowRepository.findAndCount({
      where,
      relations: ['order', 'buyer', 'seller'],
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      meta: {
        current: page,
        pageSize: limit,
        pages: Math.ceil(total / limit),
        total,
      },
      result,
    };
  }

  async getHeldBalance(sellerId: number) {
    const result = await this.escrowRepository
      .createQueryBuilder('escrow')
      .select('COALESCE(SUM(escrow.amount), 0)', 'total')
      .where('escrow.seller_id = :sellerId', { sellerId })
      .andWhere('escrow.status = :status', { status: 'holding' })
      .getRawOne();

    return { held_balance: Number(result?.total || 0) };
  }
}
