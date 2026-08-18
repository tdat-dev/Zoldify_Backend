import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { Order, OrderStatus } from '@ordering/orders/entities/order.entity';
import { OrdersService } from '@ordering/orders/orders.service';

/** Đơn để quá lâu mà không nhúc nhích thì bị huỷ. */
const STALE_AFTER_HOURS = 48;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Huỷ những đơn nằm im quá 48 giờ.
   *
   * Việc huỷ giao HẲN cho `OrdersService.cancelExpired`, job này chỉ đi tìm
   * xem đơn nào cần huỷ.
   *
   * Trước 14/08 job tự làm lấy, và làm sai theo đúng cách mà `cancel()` từng
   * sai: đặt trạng thái huỷ rồi trả hàng về kho TRƯỚC, hoàn tiền SAU, ba lần
   * ghi rời nhau không chung transaction, và lỗi hoàn tiền chỉ bị
   * `logger.error` rồi đi tiếp đơn kế. Kết quả: đơn ghi là đã huỷ, hàng đã về
   * kho, tiền người mua kẹt trong `escrow_hold` không lối ra. Nó cũng không
   * đóng link thanh toán còn treo, nên đơn vừa bị huỷ tự động vẫn trả tiền vào
   * được.
   *
   * Bài học không phải "sửa lại cho đúng" mà là "đừng có bản sao thứ hai".
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoCancelOrders() {
    const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 3600 * 1000);

    // KHÔNG đụng đơn đã có mã vận đơn.
    //
    // Có mã vận đơn nghĩa là kiện hàng đã nằm trong tay GHN. Huỷ đơn lúc đó là
    // hoàn tiền cho người mua trong khi món hàng vẫn đang trên đường tới nhà
    // họ — người bán mất cả hàng lẫn tiền, và không thao tác nào của họ gây ra
    // chuyện đó. Bản cũ quét cả những đơn này.
    const staleOrders = await this.orderRepository.find({
      where: [
        {
          status: OrderStatus.PENDING,
          created_at: LessThan(cutoff),
          tracking_code: IsNull(),
        },
        {
          status: OrderStatus.CONFIRMED,
          created_at: LessThan(cutoff),
          tracking_code: IsNull(),
        },
      ],
      select: ['id', 'order_code'],
    });

    if (!staleOrders.length) return;

    this.logger.log(`Có ${staleOrders.length} đơn quá hạn, bắt đầu huỷ.`);

    let done = 0;
    for (const order of staleOrders) {
      try {
        await this.ordersService.cancelExpired(order.id);
        done += 1;
        this.logger.log(`Đã huỷ đơn quá hạn #${order.order_code}`);
      } catch (err) {
        // Một đơn hỏng không được làm chết cả lượt quét. Nhưng đơn đó thì
        // KHÔNG bị đổi gì cả: `cancelExpired` chạy trong một transaction, hỏng
        // là quay lui sạch, không để lại trạng thái nửa vời như bản cũ.
        this.logger.error(
          `Không huỷ được đơn #${order.order_code}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(`Hoàn tất: huỷ ${done}/${staleOrders.length} đơn quá hạn.`);
  }

  /**
   * Chốt vận đơn theo hai bước, giống Shopee/Lazada:
   *  1. Đồng bộ trạng thái GHN — lô GHN báo 'đã giao' thì ghi mốc delivered_at.
   *  2. Tự xác nhận — lô đã giao quá cửa sổ N ngày mà người mua chưa bấm thì tự
   *     chốt và giải ngân cho người bán.
   *
   * Cả hai việc nặng (đọc GHN, đụng tiền) đều nằm trong OrdersService; job này
   * chỉ hẹn giờ và ghi log — cùng nguyên tắc "đừng có bản sao thứ hai" như
   * autoCancelOrders.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async settleDeliveredShipments() {
    try {
      const sync = await this.ordersService.syncGhnShipmentStatuses();
      if (sync.delivered > 0) {
        this.logger.log(
          `Đồng bộ GHN: ${sync.delivered}/${sync.checked} lô chuyển 'đã giao'.`,
        );
      }
      const auto = await this.ordersService.autoConfirmDueShipments();
      if (auto.released > 0) {
        this.logger.log(
          `Tự xác nhận nhận hàng: giải ngân ${auto.released}/${auto.due} lô quá cửa sổ.`,
        );
      }
    } catch (err) {
      this.logger.error(`Lượt chốt vận đơn lỗi: ${(err as Error).message}`);
    }
  }
}
