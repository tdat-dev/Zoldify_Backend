/**
 * Response chỉ có thông báo, không kèm dữ liệu.
 *
 * Dùng cho các thao tác như gửi OTP, đăng xuất, đổi mật khẩu — nơi client
 * chỉ cần biết đã thành công và hiển thị câu thông báo.
 */
export class MessageResponseDto {
  message: string;
}
