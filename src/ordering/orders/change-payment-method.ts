import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { PaymentMethod } from '@common/enums/payment.enum';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderActor } from './order-status.policy';

/** Cách trả người mua được chọn lại: đúng ba cách trang thanh toán đang có. */
export const SWITCHABLE_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.COD,
  PaymentMethod.WALLET,
  PaymentMethod.PAYOS,
];

export interface ChangePaymentMethodDeps {
  orderRepository: Repository<Order>;
  /** Đọc đơn và vai của người gọi với đơn đó (OrdersService.findOneForActor). */
  findForActor: (id: number) => Promise<{ order: Order; actors: OrderActor[] }>;
  /** Đóng link PayOS còn mở của đơn (OrdersService.voidOpenPaymentLink). */
  closePaymentLink: (orderId: number) => Promise<void>;
}

/**
 * Đổi cách trả cho đơn CHƯA TRẢ (báo lỗi 12/11).
 *
 * Đơn được tạo trước khi trả tiền. Chọn PayOS mà không trả được, hay chọn ví
 * mà ví thiếu tiền, thì đơn chỉ còn nút "Thanh toán ngay" theo đúng cách cũ:
 * muốn trả khi nhận hàng phải huỷ rồi đặt lại, trong khi giỏ đã bị xoá.
 *
 * Chỉ người mua, chỉ khi đơn còn `pending` và chưa trả: sau khi người bán xác
 * nhận, cách trả quyết định vận đơn GHN (COD thu hộ hay không) nên không đổi
 * được nữa. Admin cũng không đổi hộ: cách trả là lựa chọn của người trả tiền.
 *
 * Đóng link PayOS TRƯỚC khi đổi: đổi trước thì vẫn còn một khe để người mua trả
 * qua link cũ vào một đơn đã thành COD. Rồi UPDATE có điều kiện `status =
 * pending AND is_paid = 0`, để một lần trả tiền chen vào giữa lượt đọc và lượt
 * ghi (webhook PayOS, trả ví ở tab khác) không bị đè mất.
 */
export async function changePaymentMethod(
  deps: ChangePaymentMethodDeps,
  id: number,
  method: PaymentMethod,
): Promise<void> {
  if (!SWITCHABLE_PAYMENT_METHODS.includes(method)) {
    throw new BadRequestException(
      'Chỉ đổi được sang trả khi nhận hàng, ví Zoldify hoặc PayOS',
    );
  }

  const { order, actors } = await deps.findForActor(id);
  if (!actors.includes(OrderActor.BUYER)) {
    throw new ForbiddenException('Chỉ người mua mới đổi được cách trả');
  }
  if (order.is_paid) {
    throw new BadRequestException('Đơn đã thanh toán nên không đổi cách trả');
  }
  if (order.status !== OrderStatus.PENDING) {
    throw new BadRequestException(
      'Người bán đã xác nhận đơn nên không đổi cách trả được nữa',
    );
  }
  if (order.payment_method === method) return;

  if (order.payment_method === PaymentMethod.PAYOS) {
    await deps.closePaymentLink(order.id);
  }

  const result = await deps.orderRepository
    .createQueryBuilder()
    .update(Order)
    .set({ payment_method: method })
    .where('id = :id AND status = :pending AND is_paid = 0', {
      id,
      pending: OrderStatus.PENDING,
    })
    .execute();
  if (result.affected !== 1) {
    throw new ConflictException(
      'Đơn vừa đổi trạng thái hoặc vừa được thanh toán. Tải lại đơn rồi thử lại.',
    );
  }
}
