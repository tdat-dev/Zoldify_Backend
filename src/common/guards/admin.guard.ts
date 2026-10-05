import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.user || request.user.role !== 'admin') {
      throw new ForbiddenException('Chỉ admin mới có quyền truy cập');
    }
    return true;
  }
}