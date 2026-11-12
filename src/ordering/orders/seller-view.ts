import type { Order } from './entities/order.entity';

export type SellerViewOrder = Order & {
  /** Tiền hàng phần của người bán này (giá x số lượng các món của họ). */
  seller_total: number;
  /** Đơn còn hàng của người bán khác: người bán không tự huỷ được đơn này. */
  multi_seller: boolean;
};

/**
 * Cắt một đơn về đúng phần của MỘT người bán, cho `GET /orders?as=seller`.
 *
 * Test staging 12/11 (MUA-03): màn Đơn bán (web /shop/orders, app Đơn bán) lọc
 * đúng tập đơn nhưng trả mọi món, nên đơn có hàng của hai người bán thì mỗi
 * người thấy cả món và tổng tiền của người kia (QA Shop B thấy "Mũ lưỡi trai
 * giá rẻ" của Shop Zoldify và tổng 997.800 của cả đơn). Cùng luật với
 * `ShopService.getSellerOrders` và `OrdersService.findOne` khi người gọi chỉ là
 * người bán.
 *
 * Cần `items.product.seller` đã nạp. Bỏ `seller` khỏi từng món sau khi lọc để
 * phản hồi giữ hình dạng cũ và không kèm thông tin tài khoản người bán.
 */
export function toSellerView(order: Order, sellerId: number): SellerViewOrder {
  const all = order.items ?? [];
  const isMine = (i: (typeof all)[number]) =>
    i.product?.seller?.id === sellerId;
  const mine = all.filter(isMine);
  for (const item of mine) {
    if (item.product) delete (item.product as { seller?: unknown }).seller;
  }
  return Object.assign(order, {
    items: mine,
    seller_total: mine.reduce(
      (sum, i) => sum + Number(i.price) * Number(i.quantity),
      0,
    ),
    multi_seller: all.some((i) => !isMine(i)),
  });
}
