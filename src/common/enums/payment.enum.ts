export enum PaymentMethod {
  COD = 'cod', // Thanh toán khi nhận hàng
  BANK_TRANSFER = 'bank_transfer', // Thanh toán bằng ngân hàng
  WALLET = 'wallet', // Thanh toán bằng ví
  MOMO = 'momo', // Thanh toán bằng momo
  VNPAY = 'vnpay', // Thanh toán bằng vnpay
  PAYOS = 'payos',
}


export enum PaymentStatus {
  PENDING = 'pending', // Chờ thanh toán
  SUCCESS = 'success', // Thanh toán thành công
  FAILED = 'failed', // Thanh toán thất bại
}

export enum PaymentType {
  ORDER_PAYMENT = 'order_payment', // Thanh toán đơn hàng
  WALLET_TOPUP = 'wallet_topup', // Nạp tiền vào ví
}
