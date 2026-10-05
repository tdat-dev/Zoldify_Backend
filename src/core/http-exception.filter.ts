import { ExceptionFilter, Catch, ArgumentsHost, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const res = exception.getResponse();

    // Nếu là lỗi file quá lớn (413), trả về message cụ thể
    if (exception instanceof PayloadTooLargeException) {
      return response.status(status).json({
        error: "Dữ liệu gửi lên quá lớn",
        message: "Tệp quá lớn, dung lượng tối đa 100MB",
        statusCode: status,
      });
    }

    // Các lỗi khác trả về message gốc
    response.status(status).json({
      ...(typeof res === 'object' ? res : { message: res }),
      statusCode: status,
    });
  }
}

