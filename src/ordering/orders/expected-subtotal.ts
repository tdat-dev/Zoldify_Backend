import { ConflictException } from '@nestjs/common';

/**
 * Chặn đơn khi tiền hàng tính theo giá hiện tại lệch số trang thanh toán đã
 * hiện cho người mua (test staging 12/11, MUA-02).
 *
 * Giỏ không lưu giá lúc thêm. Bộ chặn "Giá ... vừa thay đổi" trong transaction
 * của `OrdersService.create` chỉ so giá đọc đầu hàm với giá lúc khoá dòng, nên
 * nó bắt giá đổi trong vài trăm mili giây đó, không bắt giá đổi từ lúc người
 * mua mở trang thanh toán. Đo: thấy 800.000, đơn #24 ra 810.000, không báo gì.
 *
 * Gọi TRƯỚC transaction để không trừ kho, không để lại đơn dở. Client không gửi
 * số (app bản cũ đang cài) thì bỏ qua: chặn những bản đó là chặn đặt hàng.
 * Nợ: khi mọi bản app đều gửi trường này thì có thể bắt buộc nó.
 */
export function assertSubtotalUnchanged(
  expected: number | undefined,
  actual: number,
): void {
  if (expected === undefined || Number(expected) === actual) return;
  throw new ConflictException(
    'Giá trong giỏ vừa thay đổi ' +
      `(${Number(expected).toLocaleString('vi-VN')}đ → ` +
      `${actual.toLocaleString('vi-VN')}đ). Mời bạn xem lại giỏ hàng ` +
      'rồi đặt lại đơn.',
  );
}
