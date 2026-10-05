import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const User = createParamDecorator(
  // data: dữ liệu được truyền vào decorator
  // ctx: context chứa thông tin về request
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
