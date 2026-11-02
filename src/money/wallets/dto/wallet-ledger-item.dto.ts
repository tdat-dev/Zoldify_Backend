/**
 * Một dòng lịch sử ví, đọc từ sổ cái (`ledger_entries` + `ledger_transactions`).
 *
 * Trước đây `GET /wallets/transactions` khai trong OpenAPI là entity
 * `WalletTransaction` của bảng `wallet_transactions` cũ: bảng đó đã ngừng được
 * ghi từ khi chuyển sang sổ cái, và hình dạng của nó (`balance_before`,
 * `reference` dạng chuỗi) không khớp thứ endpoint thật sự trả. App sinh kiểu từ
 * file OpenAPI nên đọc nhầm. Lớp này mô tả đúng cái `getTransactions` trả về.
 */
export class WalletLedgerItemDto {
  /** id của bút toán (ledger_entries.id), tăng dần theo thời gian */
  id: number;

  /** Loại sự kiện tiền */
  type:
    | 'topup'
    | 'order_hold'
    | 'escrow_release'
    | 'escrow_refund'
    | 'withdrawal_approve'
    | 'withdrawal_complete'
    | 'adjustment';

  /** Số tiền (đồng). Dương là tiền vào ví, âm là tiền ra khỏi ví */
  amount: number;

  /** Số dư khả dụng ngay sau bút toán này (đồng) */
  balance_after: number;

  /** Sự kiện gắn với đối tượng nào: order, escrow, payment, withdrawal */
  reference_type: string | null;

  /** id của đối tượng ở `reference_type` */
  reference_id: number | null;

  /**
   * Mã đơn (orders.id) nếu dòng này thuộc một đơn: trả bằng ví, hoàn tiền khi
   * huỷ, tiền bán hàng về. Null với nạp, rút, chuyển tiền.
   */
  order_id: number | null;

  /** Ghi chú kèm giao dịch, nếu có */
  note: string | null;

  /** Thời điểm ghi sổ */
  created_at: Date;
}
