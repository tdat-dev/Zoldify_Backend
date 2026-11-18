/**
 * Giá trần một món: 10 tỷ (đơn vị tiền của món).
 *
 * Trước 18/11 chỉ có `@Min(1)`, nên gọi thẳng API với giá 17 chữ số thì lọt
 * qua validate và vỡ ở MySQL: cột `price` là DECIMAL(15,2), chứa tới ~10¹³.
 * Lỗi đó ra 500 kèm câu "thử lại", trong khi đây là lỗi dữ liệu gửi lên — 400.
 *
 * Cùng số với app mobile (`src/features/products/price-input.ts`) và với trần
 * giá trợ lý tìm đồ dùng để loại số mô hình đọc nhầm đơn vị.
 */
export const GIA_TOI_DA = 10_000_000_000;
