/**
 * Kiểu dùng chung cho sổ cái.
 *
 * Tiền lưu bằng BIGINT đơn vị ĐỒNG, không phải DECIMAL. Tiền Việt không có
 * xu, và `Number()` của JS mất chính xác với số lớn mà không báo lỗi gì.
 * Trong code dùng `bigint` của JS để không thể lỡ tay cộng số thực.
 */

/** Ai sở hữu tài khoản trong sổ cái */
export enum LedgerOwnerType {
  /** Người dùng thật, owner_id là users.id */
  USER = 'user',
  /** Sàn Zoldify, owner_id null */
  PLATFORM = 'platform',
  /** Thế giới bên ngoài: cổng thanh toán, ngân hàng. owner_id null */
  EXTERNAL = 'external',
}

/** Tài khoản đó giữ tiền ở trạng thái nào */
export enum LedgerPurpose {
  /** Tiền người dùng tiêu được ngay */
  AVAILABLE = 'available',
  /** Tiền sàn đang giữ hộ, chưa của ai — phải khớp số dư ngân hàng thật */
  ESCROW_HOLD = 'escrow_hold',
  /** Đã trừ của người bán, admin đang chuyển khoản, chưa ra khỏi hệ thống */
  WITHDRAWAL_PENDING = 'withdrawal_pending',
  /** Doanh thu của sàn từ phí */
  REVENUE = 'revenue',
  /** Đối ứng cho tiền đi vào từ cổng thanh toán */
  GATEWAY_CLEARING = 'gateway_clearing',
  /** Đối ứng cho tiền đã rời khỏi hệ thống ra ngân hàng */
  BANK_EXTERNAL = 'bank_external',
}

/** Loại sự kiện tiền, để đọc sổ cho dễ và lọc báo cáo */
export enum LedgerTxType {
  TOPUP = 'topup',
  ORDER_HOLD = 'order_hold',
  ESCROW_RELEASE = 'escrow_release',
  ESCROW_REFUND = 'escrow_refund',
  WITHDRAWAL_APPROVE = 'withdrawal_approve',
  WITHDRAWAL_COMPLETE = 'withdrawal_complete',
  ADJUSTMENT = 'adjustment',
}

/**
 * TypeORM trả cột BIGINT về dạng chuỗi. Transformer này đổi qua lại với
 * `bigint` của JS để tầng nghiệp vụ không bao giờ chạm vào number.
 */
export const bigintTransformer = {
  /**
   * Giữ nguyên `undefined` chứ KHÔNG đổi thành `null`.
   *
   * Đổi thành null làm TypeORM gửi `balance = NULL` xuống lúc INSERT, và
   * cột NOT NULL sẽ từ chối — trong khi ý định là "không truyền gì, để
   * database dùng DEFAULT 0".
   */
  to: (value?: bigint | null): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value.toString();
  },
  from: (value?: string | null): bigint | null =>
    value === null || value === undefined ? null : BigInt(value),
};
