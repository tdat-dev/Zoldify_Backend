/**
 * Hợp đồng "gửi một thông báo" cho những tầng không được import messaging.
 *
 * VÌ SAO Ở `common`. `ordering -> messaging` là vi phạm ranh giới (eslint
 * boundaries, bánh cóc 28 trong scripts/check-boundaries.mjs, chỉ được giảm).
 * `orders.service.ts` đã mang sẵn một vi phạm đó từ trước; import thêm
 * NotificationsService vào `shipment-tracking.service.ts` là vi phạm thứ 29 và
 * CI đỏ. Nên NotificationsModule gắn chính NotificationsService vào token này
 * (`useExisting`), còn bên dùng chỉ biết token và đúng một hàm `create`. Cùng
 * cách với `hang-doi.ts`: hợp đồng chung đặt ở tầng cả hai bên đều được nhìn.
 */
export const KENH_THONG_BAO = 'KENH_THONG_BAO';

/** Đúng phần của NotificationsService mà bên ngoài messaging cần. */
export interface KenhThongBao {
  create(dto: {
    user_id: number;
    /** Giá trị của NotificationType ('order_status', 'system'...), ép `never`. */
    type: never;
    title: string;
    content: string;
    data?: Record<string, unknown>;
  }): Promise<unknown>;
}
