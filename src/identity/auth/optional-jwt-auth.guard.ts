import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { IUser } from '@identity/users/users.interface';

/** Cờ trên request: có gửi token nhưng token không dùng được. */
export const TOKEN_HONG = 'tokenHong';

/** Request sau khi đi qua OptionalJwtAuthGuard. */
export type RequestNguoiXem = Request & {
  user?: IUser | null;
  [TOKEN_HONG]?: boolean;
};

/**
 * Xác thực TUỲ CHỌN cho route công khai mà kết quả khác nhau theo người xem.
 *
 * Ví dụ duy nhất hiện nay: GET /products/:id. Khách vãng lai chỉ thấy sản
 * phẩm đang bán, còn chủ sản phẩm và admin thấy cả bản nháp (trang sửa sản
 * phẩm của web nạp form bằng đúng route này, kèm token). `@Public()` một mình
 * thì `JwtAuthGuard` bỏ qua passport nên `req.user` luôn trống, chủ sản phẩm
 * cũng thành khách.
 *
 * Luật:
 *  - Không có header Authorization: cho qua, `req.user` trống. Không gọi
 *    passport, không tốn một câu SELECT users nào cho khách vãng lai.
 *  - Có token hợp lệ: `req.user` như mọi route cần đăng nhập (JwtStrategy vẫn
 *    kiểm khoá tài khoản, token_version).
 *  - Có token nhưng hỏng (hết hạn, bị thu hồi): KHÔNG ném 401 ngay, vì trang
 *    sản phẩm đang bán vẫn phải mở được với token cũ. Đánh dấu `tokenHong`
 *    để service quyết: chỉ khi người đó cần quyền chủ (mở bản nháp) mới trả
 *    401, cho app làm mới token rồi gọi lại, thay vì 404 làm người bán tưởng
 *    sản phẩm của mình đã mất.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<RequestNguoiXem>();
    if (!req.headers?.authorization) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = IUser>(
    err: unknown,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      const req = context.switchToHttp().getRequest<RequestNguoiXem>();
      req[TOKEN_HONG] = true;
      return null as TUser;
    }
    return user;
  }
}
