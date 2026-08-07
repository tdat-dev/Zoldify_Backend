/**
 * Hình dạng dữ liệu auth trả về cho client.
 *
 * Cố ý KHÔNG trả nguyên entity User: entity có password, refresh_token,
 * token_version và hàng loạt cột nội bộ mà client không cần biết.
 */

export class AuthUserDto {
  id: number;
  full_name: string;
  email: string;
  role: string;
}

export class LoginResponseDto {
  /** JWT dùng cho mọi request sau đó, đặt vào header Authorization */
  access_token: string;

  /** Dùng để xin access_token mới khi cái cũ hết hạn */
  refresh_token: string;

  user: AuthUserDto;
}
