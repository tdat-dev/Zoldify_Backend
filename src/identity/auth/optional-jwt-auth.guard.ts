import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { IUser } from '@identity/users/users.interface';

/** Request sau khi đi qua OptionalJwtAuthGuard. */
export type RequestNguoiXem = Request & {
  user?: IUser | null;
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
 *  - Có token nhưng hỏng (hết hạn, bị thu hồi): coi như khách vãng lai, KHÔNG
 *    BAO GIỜ 401. Web và app không có luồng làm mới token, gặp 401 là xoá
 *    phiên: người mua token hết hạn mở trang sản phẩm mà bị đăng xuất là sai.
 *    Và 401 khác 404 thì thành chỉ điểm id nào là bản nháp (review 27/10).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<RequestNguoiXem>();
    if (!req.headers?.authorization) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = IUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) return null as TUser;
    return user;
  }
}
