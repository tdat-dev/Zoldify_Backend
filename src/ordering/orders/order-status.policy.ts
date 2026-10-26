import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderStatus } from './entities/order.entity';

/**
 * Ai đang gọi, xét theo quan hệ với ĐƠN HÀNG này — không phải theo cột role
 * trong bảng users.
 *
 * Một người có role 'seller' vẫn là BUYER với đơn họ tự đặt. Phân quyền tiền
 * phải xét theo quan hệ, nếu không thì bất kỳ người bán nào cũng tự nhả được
 * ký quỹ của đơn người khác.
 */
export enum OrderActor {
  BUYER = 'buyer',
  SELLER = 'seller',
  ADMIN = 'admin',
}

interface TransitionRule {
  /** Chỉ được chuyển sang trạng thái này từ các trạng thái sau */
  from: OrderStatus[];
  /** Và chỉ những vai này được phép */
  actors: OrderActor[];
  /** Giải thích khi bị từ chối, để client hiển thị được cho người dùng */
  reason?: string;
}

/**
 * Bảng chuyển trạng thái đơn hàng.
 *
 * Nguyên tắc chia quyền: **ai được lợi thì không được tự bấm.**
 *  - Người bán KHÔNG được đặt `delivered`, vì delivered là lệnh nhả tiền cho
 *    chính họ.
 *  - Người mua KHÔNG được đặt `refunded`, vì refunded là lệnh trả tiền về ví
 *    chính họ trong khi hàng vẫn đang giữ.
 *
 * `pending` và `cancelled` không có đường vào qua endpoint này: pending là
 * trạng thái lúc tạo đơn, còn huỷ thì phải đi qua /cancel hoặc /cancel-sale vì
 * hai chỗ đó còn phải hoàn kho.
 */
const RULES: Record<OrderStatus, TransitionRule> = {
  [OrderStatus.PENDING]: {
    from: [],
    actors: [],
    reason: 'Đơn chỉ ở trạng thái Chờ xác nhận ngay khi vừa được tạo',
  },
  [OrderStatus.CONFIRMED]: {
    from: [OrderStatus.PENDING],
    actors: [OrderActor.SELLER, OrderActor.ADMIN],
  },
  [OrderStatus.PROCESSING]: {
    from: [OrderStatus.CONFIRMED],
    actors: [OrderActor.SELLER, OrderActor.ADMIN],
  },
  [OrderStatus.SHIPPING]: {
    from: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING],
    // GHN-driven: chỉ hệ thống/admin (poll GHN hoặc giả lập sandbox) đặt "Đang
    // giao" — người bán KHÔNG tự bấm, vì trạng thái này đến từ tracking GHN.
    actors: [OrderActor.ADMIN],
  },
  [OrderStatus.DELIVERED]: {
    from: [OrderStatus.SHIPPING],
    actors: [OrderActor.BUYER, OrderActor.ADMIN],
    reason:
      'Chỉ người mua mới xác nhận đã nhận hàng. Người bán không tự đánh dấu ' +
      'đã giao được, vì đó là lệnh nhả tiền ký quỹ cho chính mình',
  },
  [OrderStatus.CANCELLED]: {
    from: [],
    actors: [],
    reason:
      'Huỷ đơn phải gọi PATCH /orders/:id/cancel (người mua) hoặc ' +
      '/orders/:id/cancel-sale (người bán) — hai chỗ đó còn hoàn lại tồn kho',
  },
  [OrderStatus.REFUNDED]: {
    from: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    actors: [OrderActor.ADMIN],
    reason: 'Chỉ admin mới được hoàn tiền một đơn đã giao',
  },
};

/**
 * Đơn đã khép lại mà hàng KHÔNG tới tay người mua: huỷ, hoặc đã hoàn tiền.
 *
 * Mọi đường đặt `delivered` không qua bảng RULES (người mua bấm nhận từng lô,
 * job tự xác nhận sau N ngày) phải loại các trạng thái này. Thiếu nó thì đơn
 * đã huỷ vẫn bị kéo sang `delivered` chỉ vì còn một lô GHN sống sót (bài kiểm
 * E trong `dua-trang-thai-don.spec.ts`).
 *
 * Vì sao liệt kê trạng thái ĐÓNG chứ không liệt kê trạng thái "đang giao":
 * đơn COD được admin ghi nhận đã thu tiền có thể vẫn nằm ở `pending` trong
 * lúc hàng đi (TC-P0-05b, TC-P2-17). Chặn theo danh sách "đang giao" là chặn
 * nhầm cả những đơn đó.
 */
export const DA_DONG_KHONG_GIAO: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

/** Trạng thái đích nào kéo theo việc tiền đổi chủ */
export const MONEY_MOVING_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.REFUNDED,
];

/**
 * Chặn ở hai tầng: đúng vai VÀ đúng bước.
 *
 * Thiếu tầng nào cũng vô nghĩa. Chỉ kiểm vai thì người mua nhảy thẳng từ
 * `pending` sang `delivered` mà không cần ai giao hàng. Chỉ kiểm bước thì
 * người bán tự bấm `delivered` để lấy tiền.
 */
export function assertTransitionAllowed(
  from: OrderStatus,
  to: OrderStatus,
  actors: OrderActor[],
): void {
  if (from === to) {
    throw new BadRequestException(`Đơn hàng đã ở trạng thái "${to}" rồi`);
  }

  const rule = RULES[to];
  if (!rule) {
    throw new BadRequestException(`Trạng thái "${to}" không hợp lệ`);
  }

  if (!rule.from.length) {
    throw new BadRequestException(
      rule.reason ?? `Không thể chuyển sang trạng thái "${to}" qua API này`,
    );
  }

  if (!rule.from.includes(from)) {
    throw new BadRequestException(
      `Không thể chuyển từ "${from}" sang "${to}". ` +
        `Chỉ đi được từ: ${rule.from.join(', ')}`,
    );
  }

  if (!rule.actors.some((allowed) => actors.includes(allowed))) {
    throw new ForbiddenException(
      rule.reason ??
        `Bạn không có quyền chuyển đơn sang trạng thái "${to}". ` +
          `Chỉ ${rule.actors.join(' hoặc ')} mới được`,
    );
  }
}
