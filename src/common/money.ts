/**
 * Định dạng tiền cho chữ do BACKEND sinh ra — thông báo, email, log.
 *
 * Vì sao backend cũng cần: phần lớn tiền hiển thị đi qua `formatPrice` bên
 * frontend, nhưng không phải tất cả. Thông báo "vừa đăng sản phẩm mới" và mail
 * OTP là chuỗi dựng sẵn ở máy chủ rồi mới gửi đi, nên chúng phải tự định dạng.
 * Chỗ đó trước đây ghép cứng `toLocaleString('vi-VN') + 'đ'` — một món niêm yết
 * bằng USD sẽ báo cho người theo dõi là "2.400đ", sai lệch hơn hai mươi lần.
 *
 * ⚠️ KHÔNG quy đổi tỉ giá. Hàm này chỉ in đúng con số kèm đúng ký hiệu.
 */
const LOCALE_BY_CURRENCY: Record<string, string> = {
  VND: 'vi-VN',
  USD: 'en-US',
  EUR: 'de-DE',
  JPY: 'ja-JP',
};

export const DEFAULT_CURRENCY = 'VND';

export function formatMoney(
  value: number | string | null | undefined,
  currency: string = DEFAULT_CURRENCY,
): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const cur = currency || DEFAULT_CURRENCY;
  const locale = LOCALE_BY_CURRENCY[cur] ?? 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: cur,
      // Đồng không có phần lẻ; tiền tệ khác giữ mặc định của Intl.
      maximumFractionDigits: cur === 'VND' ? 0 : undefined,
    }).format(amount);
  } catch {
    // Mã tiền tệ lạ (DTO chỉ kiểm hình dạng 3 chữ hoa, không kiểm mã có thật)
    // thì vẫn in ra số chứ không ném lỗi giữa lúc gửi thông báo.
    return `${amount.toLocaleString(locale)} ${cur}`;
  }
}
