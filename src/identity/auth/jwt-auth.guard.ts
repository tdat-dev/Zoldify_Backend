
import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { IS_PUBLIC_KEY, IS_PUBLIC_PERMISSIONS } from '@common/decorators/public.decorator';
 
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super()
  }
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest(err, user, info, context) {
    const request: Request  = context.switchToHttp().getRequest();

    // Tận dụng decorator @SkipCheckPermissions để đánh dấu cho controller biết rằng controller này không cần phải check quyền
    // Tức là controller này có thể truy cập công khai và không cần token
    const isSkipPermission = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);


    // Bạn có thể ném ra ngoại lệ (báo lỗi) dựa trên tham số 'info' hoặc 'err'.
    if (err || !user) {
      throw err || new UnauthorizedException('Token không hợp lệ/ không có token ở header');
    }

    // 🌟 MẸO CỦA THẦY: Nếu là ADMIN, cho phép qua luôn không cần check permissions chi tiết!
    if (user.role === 'admin') {
      return user;
    }

    // Nếu là route auth thì không cần check permission
    if (request.path.startsWith('/auth')) return user;

    return user;
  }
}
