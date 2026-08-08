import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderStatus } from './entities/order.entity';
import { assertTransitionAllowed, OrderActor } from './order-status.policy';

/**
 * Hàm thuần, không cần database.
 *
 * Hai test đầu là lý do cả file này tồn tại: chúng mô tả đúng hai cách rút
 * tiền khỏi hệ thống mà code cũ cho phép.
 */
describe('assertTransitionAllowed', () => {
  const buyer = [OrderActor.BUYER];
  const seller = [OrderActor.SELLER];
  const admin = [OrderActor.ADMIN];

  describe('chặn khai thác', () => {
    it('người bán KHÔNG tự đánh dấu đã giao để nhả tiền cho mình', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.SHIPPING,
          OrderStatus.DELIVERED,
          seller,
        ),
      ).toThrow(ForbiddenException);
    });

    it('người mua KHÔNG tự hoàn tiền về ví mình trong khi vẫn giữ hàng', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.DELIVERED,
          OrderStatus.REFUNDED,
          buyer,
        ),
      ).toThrow(ForbiddenException);
    });

    it('người mua KHÔNG nhảy thẳng từ chờ xác nhận sang đã giao', () => {
      // Đúng vai nhưng sai bước: chưa ai giao hàng mà đã nhả ký quỹ
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.PENDING,
          OrderStatus.DELIVERED,
          buyer,
        ),
      ).toThrow(BadRequestException);
    });

    it('gọi lại đúng trạng thái hiện tại thì bị chặn, không nhả tiền lần hai', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.DELIVERED,
          OrderStatus.DELIVERED,
          admin,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('đường đi hợp lệ', () => {
    it('người bán xác nhận đơn mới', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.PENDING,
          OrderStatus.CONFIRMED,
          seller,
        ),
      ).not.toThrow();
    });

    it('người bán chuyển sang đang giao', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.CONFIRMED,
          OrderStatus.SHIPPING,
          seller,
        ),
      ).not.toThrow();
    });

    it('người mua xác nhận đã nhận hàng khi đơn đang giao', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.SHIPPING,
          OrderStatus.DELIVERED,
          buyer,
        ),
      ).not.toThrow();
    });

    it('admin hoàn tiền đơn đã giao', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.DELIVERED,
          OrderStatus.REFUNDED,
          admin,
        ),
      ).not.toThrow();
    });

    it('người vừa mua vừa bán trong cùng đơn được cả hai quyền', () => {
      const both = [OrderActor.BUYER, OrderActor.SELLER];
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.PENDING,
          OrderStatus.CONFIRMED,
          both,
        ),
      ).not.toThrow();
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.SHIPPING,
          OrderStatus.DELIVERED,
          both,
        ),
      ).not.toThrow();
    });
  });

  describe('lối đi phải dùng endpoint khác', () => {
    it('không huỷ đơn qua đường đổi trạng thái, vì còn phải hoàn kho', () => {
      for (const actors of [buyer, seller, admin]) {
        expect(() =>
          assertTransitionAllowed(
            OrderStatus.PENDING,
            OrderStatus.CANCELLED,
            actors,
          ),
        ).toThrow(BadRequestException);
      }
    });

    it('không quay ngược đơn về chờ xác nhận', () => {
      expect(() =>
        assertTransitionAllowed(
          OrderStatus.SHIPPING,
          OrderStatus.PENDING,
          admin,
        ),
      ).toThrow(BadRequestException);
    });
  });

  it('mọi cặp trạng thái không nằm trong bảng đều bị chặn', () => {
    const all = Object.values(OrderStatus);
    const allowed = new Set([
      `${OrderStatus.PENDING}->${OrderStatus.CONFIRMED}`,
      `${OrderStatus.CONFIRMED}->${OrderStatus.PROCESSING}`,
      `${OrderStatus.CONFIRMED}->${OrderStatus.SHIPPING}`,
      `${OrderStatus.PROCESSING}->${OrderStatus.SHIPPING}`,
      `${OrderStatus.SHIPPING}->${OrderStatus.DELIVERED}`,
      `${OrderStatus.DELIVERED}->${OrderStatus.REFUNDED}`,
      `${OrderStatus.CANCELLED}->${OrderStatus.REFUNDED}`,
    ]);

    // Admin là vai rộng nhất; cái gì admin không đi được thì không ai đi được.
    for (const from of all) {
      for (const to of all) {
        if (allowed.has(`${from}->${to}`)) continue;
        expect(() => assertTransitionAllowed(from, to, admin)).toThrow();
      }
    }
  });
});
