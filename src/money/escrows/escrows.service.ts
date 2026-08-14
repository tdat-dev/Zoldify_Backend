import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Escrow, EscrowStatus } from './entities/escrow.entity';
import { Order } from '@ordering/orders/entities/order.entity';
import { OrderItem } from '@ordering/orders/entities/order-item.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '@identity/users/entities/user.entity';
import { LedgerService } from '@money/ledger/ledger.service';
import { PlatformFeeService } from '@money/ledger/platform-fee.service';
import {
  LedgerOwnerType,
  LedgerPurpose,
  LedgerTxType,
} from '@money/ledger/ledger.types';

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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly platformFee: PlatformFeeService,
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

  /**
   * Giải ngân cho người bán, trừ phí sàn.
   *
   * Một đơn có thể chia cho nhiều người bán, nên hàm này chạy nhiều khoản.
   * TẤT CẢ nằm trong MỘT transaction: hoặc mọi người bán cùng nhận tiền, hoặc
   * không ai nhận. Nửa vời sẽ để lại escrow lệch trạng thái mà không ai biết.
   *
   * Khoá chống trùng gắn theo TỪNG khoản ký quỹ chứ không theo đơn, vì mỗi
   * khoản là một lần tiền đổi chủ riêng.
   *
   * Bản cũ cộng thẳng vào `users.balance` bằng `increment()`, không transaction
   * và không để lại dấu vết nào — không trả lời được câu "vì sao ví có số này".
   */
  async release(orderId: number) {
    return this.dataSource.transaction(async (em) => {
      const escrows = await em.find(Escrow, {
        where: { order: { id: orderId }, status: EscrowStatus.HOLDING },
        relations: ['seller'],
      });

      if (!escrows.length) {
        throw new NotFoundException('Không tìm thấy escrow nào để giải ngân');
      }

      const percent = await this.platformFee.getPercent(em);
      const hold = await this.ledger.getOrCreateAccount(
        LedgerOwnerType.PLATFORM,
        null,
        LedgerPurpose.ESCROW_HOLD,
        em,
      );
      const revenue = await this.ledger.getOrCreateAccount(
        LedgerOwnerType.PLATFORM,
        null,
        LedgerPurpose.REVENUE,
        em,
      );

      for (const escrow of escrows) {
        const amount = BigInt(Math.round(Number(escrow.amount)));
        const fee = this.platformFee.computeFee(amount, percent);

        const sellerAcc = await this.ledger.getOrCreateAccount(
          LedgerOwnerType.USER,
          escrow.seller.id,
          LedgerPurpose.AVAILABLE,
          em,
        );

        const entries = [
          { accountId: Number(hold.id), amount: -amount },
          { accountId: Number(sellerAcc.id), amount: amount - fee },
        ];
        // Phí bằng 0 thì bỏ hẳn chân này. Bút toán 0 đồng không sai nhưng
        // làm sổ khó đọc.
        if (fee > 0n) {
          entries.push({ accountId: Number(revenue.id), amount: fee });
        }

        await this.ledger.post(
          {
            idempotencyKey: `escrow_release:${escrow.id}`,
            type: LedgerTxType.ESCROW_RELEASE,
            reference: { type: 'escrow', id: escrow.id },
            metadata: { orderId, feePercent: percent, fee: fee.toString() },
            entries,
          },
          em,
        );

        escrow.status = EscrowStatus.RELEASED;
        escrow.released_at = new Date();
        await em.save(Escrow, escrow);
      }

      return escrows;
    });
  }

  /**
   * Trả tiền lại cho người mua khi đơn huỷ hoặc giao thất bại.
   *
   * KHÔNG thu phí: sàn chưa làm xong việc thì không có gì để thu.
   */
  /**
   * Trả tiền đang giữ hộ về ví người mua.
   *
   * Nhận `manager` để chạy được bên trong transaction của người gọi — huỷ đơn
   * cần việc hoàn tiền, đổi trạng thái đơn và trả hàng về kho cùng thành công
   * hoặc cùng huỷ. Không truyền thì tự mở transaction như cũ.
   *
   * Cùng quy ước với `createOrderEscrows` và `LedgerService.post`.
   */
  async refund(orderId: number, manager?: EntityManager) {
    const run = async (em: EntityManager) => {
      const escrows = await em.find(Escrow, {
        where: { order: { id: orderId }, status: EscrowStatus.HOLDING },
        relations: ['buyer'],
      });

      if (!escrows.length) {
        throw new NotFoundException('Không tìm thấy escrow nào để hoàn tiền');
      }

      const hold = await this.ledger.getOrCreateAccount(
        LedgerOwnerType.PLATFORM,
        null,
        LedgerPurpose.ESCROW_HOLD,
        em,
      );

      for (const escrow of escrows) {
        const amount = BigInt(Math.round(Number(escrow.amount)));
        const buyerAcc = await this.ledger.getOrCreateAccount(
          LedgerOwnerType.USER,
          escrow.buyer.id,
          LedgerPurpose.AVAILABLE,
          em,
        );

        await this.ledger.post(
          {
            idempotencyKey: `escrow_refund:${escrow.id}`,
            type: LedgerTxType.ESCROW_REFUND,
            reference: { type: 'escrow', id: escrow.id },
            metadata: { orderId },
            entries: [
              { accountId: Number(hold.id), amount: -amount },
              { accountId: Number(buyerAcc.id), amount },
            ],
          },
          em,
        );

        escrow.status = EscrowStatus.REFUNDED;
        await em.save(Escrow, escrow);
      }

      return escrows;
    };

    return manager ? run(manager) : this.dataSource.transaction(run);
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
