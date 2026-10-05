import { QueryFailedError } from 'typeorm';
import { ArgumentsHost } from '@nestjs/common';
import { DatabaseExceptionFilter } from './db-exception.filter';

/**
 * BÀI KIỂM ĐỎ — lỗi database phải nói được tiếng người.
 *
 * `HttpExceptionFilter` khai `@Catch(HttpException)`, nên mọi `QueryFailedError`
 * lọt qua nó và rơi vào bộ xử lý mặc định của Nest: HTTP 500
 * `"Internal server error"`.
 *
 * Nghĩa là toàn bộ 9 ràng buộc `CHECK` và khoá `UNIQUE` vừa thêm ở đợt A — lưới
 * cuối giữ cho kho không âm và tiền không sai — khi nổ thì người dùng nhận đúng
 * một dòng vô nghĩa, và người trực không biết chuyện gì xảy ra nếu không mở log.
 *
 * KHÔNG CẦN DATABASE. Bài kiểm này đo phép ánh xạ mã lỗi → HTTP, mà phép ánh xạ
 * thì thuần. Dựng `QueryFailedError` bằng tay đúng hình dạng driver mysql2 trả
 * về là đủ; bắt cả MySQL thật lên chỉ để sinh lỗi 1062 thì chậm mà không đo
 * thêm được gì.
 */

/** Dựng lỗi đúng hình dạng mà driver mysql2 ném ra. */
function loiMySQL(
  errno: number,
  message = 'nội dung SQL nội bộ',
): QueryFailedError {
  const err = new QueryFailedError('SELECT 1', [], new Error(message));
  (
    err as unknown as { driverError: { errno: number; sqlMessage: string } }
  ).driverError = {
    errno,
    sqlMessage: message,
  };
  return err;
}

/** Bản giả của ArgumentsHost, ghi lại status và body mà filter trả về. */
interface ResponseGia {
  status(s: number): ResponseGia;
  json(b: Record<string, unknown>): ResponseGia;
}

function dungHost() {
  const ghi: { status?: number; body?: Record<string, unknown> } = {};
  // Khai kiểu tường minh rồi trả `response` thay vì `this`: trong object
  // literal, `this` là `any` nên eslint (đúng) coi mỗi lần trả về là một chỗ
  // kiểu bị mất.
  const response: ResponseGia = {
    status(s: number) {
      ghi.status = s;
      return response;
    },
    json(b: Record<string, unknown>) {
      ghi.body = b;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/api/v1/orders', method: 'POST' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, ghi };
}

describe('DatabaseExceptionFilter — lỗi database nói được tiếng người', () => {
  const filter = new DatabaseExceptionFilter();

  it('vi phạm CHECK (3819) → 400, không phải 500', () => {
    const { host, ghi } = dungHost();
    filter.catch(
      loiMySQL(3819, "Check constraint 'chk_products_stock' is violated."),
      host,
    );

    expect(ghi.status).toBe(400);
    expect(String(ghi.body?.message)).toMatch(/không hợp lệ|vượt quá|âm/i);
  });

  it('trùng khoá UNIQUE (1062) → 409', () => {
    const { host, ghi } = dungHost();
    filter.catch(
      loiMySQL(1062, "Duplicate entry 'ORD-1' for key 'orders.IDX_x'"),
      host,
    );

    expect(ghi.status).toBe(409);
  });

  it('thiếu bản ghi cha (1452) → 400', () => {
    const { host, ghi } = dungHost();
    filter.catch(loiMySQL(1452, 'Cannot add or update a child row'), host);

    expect(ghi.status).toBe(400);
  });

  it('bản ghi còn được tham chiếu (1451) → 409', () => {
    const { host, ghi } = dungHost();
    filter.catch(loiMySQL(1451, 'Cannot delete or update a parent row'), host);

    expect(ghi.status).toBe(409);
  });

  it('mã lạ → 500, nhưng vẫn là câu tiếng Việt chứ không phải chuỗi mặc định', () => {
    const { host, ghi } = dungHost();
    filter.catch(loiMySQL(9999, 'chuyện gì đó chưa gặp bao giờ'), host);

    expect(ghi.status).toBe(500);
    expect(String(ghi.body?.message)).toMatch(/dữ liệu|thử lại/i);
  });

  /**
   * ĐÂY LÀ CA QUAN TRỌNG NHẤT.
   *
   * `sqlMessage` chứa tên bảng, tên cột, tên ràng buộc và cả GIÁ TRỊ gây lỗi —
   * `"Duplicate entry 'ORD-20260921-746' for key 'orders.IDX_e462...'"`. Đưa
   * nguyên nó ra ngoài là vẽ lược đồ database cho người lạ, và đôi khi lộ luôn
   * dữ liệu của người khác.
   *
   * Chi tiết phải đi vào LOG máy chủ, không đi vào response.
   */
  it('KHÔNG rò tên bảng, tên ràng buộc hay giá trị ra response', () => {
    const { host, ghi } = dungHost();
    filter.catch(
      loiMySQL(
        1062,
        "Duplicate entry 'ORD-20260921-746' for key 'orders.IDX_e462c2f2'",
      ),
      host,
    );

    const body = JSON.stringify(ghi.body);
    expect(body).not.toMatch(/orders\.IDX/);
    expect(body).not.toMatch(/ORD-20260921-746/);
    expect(body).not.toMatch(/Duplicate entry/);
  });
});
