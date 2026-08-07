// Nơi trả về data chuẩn, có status code, message, data

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RESPONSE_MESSAGE } from '@common/decorators/response.decorator';
import { RAW_RESPONSE } from '@common/decorators/raw-response.decorator';

export interface Response<T> {
  statusCode: number;
  message?: string;
  data: any;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  constructor(private reflector: Reflector) {}
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    // Route trả về định dạng không phải JSON (ví dụ sitemap.xml) thì cho
    // đi thẳng, không bọc — bọc vào là hỏng định dạng.
    const isRaw = this.reflector.get<boolean>(
      RAW_RESPONSE,
      context.getHandler(),
    );
    if (isRaw) {
      return next.handle() as Observable<Response<T>>;
    }

    return next.handle().pipe(
      map((data) => ({
        statusCode: context.switchToHttp().getResponse().statusCode,
        message:
          this.reflector.get<string>(RESPONSE_MESSAGE, context.getHandler()) ||
          '',
        data: data,
      })),
    );
  }
}
