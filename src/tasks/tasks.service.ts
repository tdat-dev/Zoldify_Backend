import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { EscrowsService } from '../escrows/escrows.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly escrowsService: EscrowsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async autoCancelOrders() {
    this.logger.log('Bắt đầu kiểm tra đơn hàng quá hạn...');

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 giờ trước

    const staleOrders = await this.orderRepository.find({
      where: [
        { status: OrderStatus.PENDING, created_at: LessThan(cutoff) },
        { status: OrderStatus.CONFIRMED, created_at: LessThan(cutoff) },
      ],
      relations: ['items', 'items.product'],
    });

    if (!staleOrders.length) {
      this.logger.log('Không có đơn hàng quá hạn.');
      return;
    }

    for (const order of staleOrders) {
      try {
        order.status = OrderStatus.CANCELLED;
        await this.orderRepository.save(order);

        // Hoàn lại stock
        for (const item of order.items) {
          if (item.product) {
            await this.productRepository.increment(
              { id: item.product.id },
              'stock',
              item.quantity,
            );
          }
        }

        // Hoàn tiền escrow nếu đã thanh toán
        if (order.is_paid) {
          await this.escrowsService.refund(order.id);
        }

        this.logger.log(`Đã hủy đơn #${order.order_code} (ID: ${order.id})`);
      } catch (err) {
        this.logger.error(
          `Lỗi khi hủy đơn #${order.order_code}: ${err.message}`,
        );
      }
    }

    this.logger.log(`Hoàn tất: đã xử lý ${staleOrders.length} đơn hàng.`);
  }
}