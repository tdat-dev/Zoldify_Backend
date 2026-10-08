import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { Request, Response } from 'express';

/**
 * Biến lỗi database thành câu trả lời hiểu được.
 *
 * VÌ SAO CẦN. `HttpExceptionFilter` khai `@Catch(HttpException)`, nên mọi
 * `QueryFailedError` lọt qua nó và rơi vào bộ xử lý mặc định của Nest:
 *
 *     HTTP 500  {"statusCode":500,"message":"Internal server error"}
 *
 * Tức toàn bộ 9 ràng buộc `CHECK` và các khoá `UNIQUE` thêm ở đợt A — lưới cuối
 * giữ cho kho không âm và tiền không sai — khi nổ thì người dùng nhận đúng một
 * dòng vô nghĩa, và người trực không biết chuyện gì nếu không mở log máy chủ.
 *
 * Tệ hơn: 500 nói "lỗi của chúng tôi". Nhưng phần lớn lỗi ở đây là **dữ liệu
 * gửi lên không hợp lệ**, tức 4xx. Trả sai mã là hướng người sửa lỗi đi nhầm
 * đường ngay từ bước đầu.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * RÒ LƯỢC ĐỒ. `sqlMessage` của MySQL chứa tên bảng, tên cột, tên ràng buộc và
 * cả GIÁ TRỊ gây lỗi:
 *
 *     Duplicate entry 'ORD-20260921-746' for key 'orders.IDX_e462c2f2237b...'
 *
 * Đưa nguyên nó ra response là vẽ lược đồ database cho người lạ, và đôi khi lộ
 * luôn dữ liệu của người khác. Nên ở đây: **chi tiết vào log, câu chung vào
 * response**. Người trực tra log bằng `requestId` là thấy đủ.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ĐÂY KHÔNG PHẢI CHỖ XỬ LÝ NGHIỆP VỤ. Mọi lỗi tới được filter này đều là lỗi
 * mà các lớp trên ĐÁNG RA phải chặn trước — DTO validation, kiểm tồn kho dưới
 * khoá, kiểm quyền. Nó là lưới cuối, và một lưới cuối hay nổ nghĩa là có lớp
 * trên đang thủng. Log ở mức `error` chính vì vậy.
 */

/** Mã lỗi MySQL. Tra ở dev.mysql.com/doc/mysql-errors. */
const MA = {
  /** Trùng khoá UNIQUE hoặc PRIMARY. */
  DUP_ENTRY: 1062,
  /** Xoá/sửa dòng cha trong khi còn dòng con trỏ tới. */
  ROW_IS_REFERENCED: 1451,
  /** Thêm/sửa dòng con trỏ tới một dòng cha không tồn tại. */
  NO_REFERENCED_ROW: 1452,
  /** Chuỗi dài quá sức chứa của cột. */
  DATA_TOO_LONG: 1406,
  /** Số vượt khoảng của kiểu cột. */
  OUT_OF_RANGE: 1264,
  /** Vi phạm ràng buộc CHECK (MySQL 8.0.16+). */
  CHECK_VIOLATED: 3819,
} as const;

interface KetQua {
  status: number;
  message: string;
  error: string;
}

/**
 * Ánh xạ mã lỗi → câu trả lời.
 *
 * Câu chữ cố ý KHÔNG nêu tên bảng hay cột: người dùng cuối không sửa được
 * chúng, còn kẻ dò thì dùng được chúng.
 */
function anhXa(errno: number | undefined): KetQua {
  switch (errno) {
    case MA.DUP_ENTRY:
      return {
        status: 409,
        message:
          'Dữ liệu này đã tồn tại. Có thể thao tác vừa rồi đã được ghi nhận — ' +
          'tải lại trang rồi kiểm tra trước khi thử lại.',
        error: 'Conflict',
      };

    case MA.ROW_IS_REFERENCED:
      return {
        status: 409,
        message:
          'Không xoá được vì dữ liệu này đang được dùng ở nơi khác. ' +
          'Gỡ các liên kết tới nó trước.',
        error: 'Conflict',
      };

    case MA.NO_REFERENCED_ROW:
      return {
        status: 400,
        message:
          'Dữ liệu tham chiếu tới một bản ghi không tồn tại (hoặc vừa bị xoá). ' +
          'Tải lại trang rồi thử lại.',
        error: 'Bad Request',
      };

    case MA.CHECK_VIOLATED:
      return {
        status: 400,
        message:
          'Giá trị gửi lên không hợp lệ — ví dụ số lượng âm, tiền âm, hoặc số ' +
          'lượng bằng 0. Kiểm tra lại rồi gửi lại.',
        error: 'Bad Request',
      };

    case MA.DATA_TOO_LONG:
      return {
        status: 400,
        message: 'Một trong các trường gửi lên dài quá mức cho phép.',
        error: 'Bad Request',
      };

    case MA.OUT_OF_RANGE:
      return {
        status: 400,
        message: 'Một giá trị số gửi lên vượt quá khoảng cho phép.',
        error: 'Bad Request',
      };

    default:
      // Mã chưa gặp bao giờ. Vẫn 500 vì ta thật sự không biết, nhưng câu chữ
      // phải nói được cho người dùng biết nên làm gì tiếp.
      return {
        status: 500,
        message:
          'Không ghi được dữ liệu lúc này. Vui lòng thử lại; nếu vẫn lỗi thì ' +
          'báo quản trị viên.',
        error: 'Internal Server Error',
      };
  }
}

@Catch(QueryFailedError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const driverError = exception.driverError as
      | { errno?: number; sqlMessage?: string }
      | undefined;
    const errno = driverError?.errno;
    const ketQua = anhXa(errno);

    // CHI TIẾT VÀO LOG, KHÔNG VÀO RESPONSE.
    //
    // Mức `error` kể cả khi trả 4xx: lỗi tới được đây nghĩa là một lớp kiểm ở
    // trên đã không chặn được, và đó là thứ đáng xem lại dù người dùng có gửi
    // dữ liệu sai thật.
    this.logger.error(
      `Lỗi database (errno=${errno ?? 'không rõ'}) ở ${request?.method ?? '?'} ` +
        `${request?.url ?? '?'}: ${driverError?.sqlMessage ?? exception.message}`,
    );

    response.status(ketQua.status).json({
      statusCode: ketQua.status,
      error: ketQua.error,
      message: ketQua.message,
    });
  }
}
