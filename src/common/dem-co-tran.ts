import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  MAX_PAGINATION_DEPTH,
  PaginationMetaDto,
  catDoSau,
} from './dto/pagination.dto';

/** Tổng số dòng cho `meta.total`, đếm tới trần độ sâu. */
export interface TongCoTran {
  /** min(số dòng thật, trần) */
  total: number;
  /** true khi số dòng thật VƯỢT trần, tức `total` là số chặn chứ không phải số thật. */
  capped: boolean;
}

/**
 * Đếm số dòng khớp bộ lọc của `qb`, nhưng DỪNG ở `tran + 1`.
 *
 * VÌ SAO KHÔNG `getCount()`. Nó là `COUNT(DISTINCT id)` không trần: với một
 * triệu sản phẩm đang bán, `GET /products` không lọc gì phải đi hết cả triệu
 * mục index ở MỖI request chỉ để điền một con số. Mà trần độ sâu (`catDoSau`)
 * đã không cho ai lật quá 10.000 dòng đầu, nên mọi con số lớn hơn 10.000 đều
 * vô dụng với việc phân trang: đếm tới 10.001 là đủ biết "còn nhiều hơn".
 *
 * CÁCH LÀM. Bọc câu lọc trong bảng con có `LIMIT tran+1`:
 *   SELECT COUNT(*) FROM (SELECT p.id FROM ... WHERE ... LIMIT 10001) dem
 * MySQL dừng đọc ngay khi bảng con đủ 10.001 dòng, nên chi phí bị chặn trên
 * bởi trần, không lớn dần theo bảng.
 *
 * Giữ nguyên mọi điều kiện (kể cả `deleted_at IS NULL` TypeORM tự thêm và các
 * JOIN dùng để lọc); chỉ bỏ phần chọn cột, sắp xếp và phân trang.
 */
export async function demCoTran<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  tran: number = MAX_PAGINATION_DEPTH,
  // Đếm theo cột khác id của bảng chính, kèm DISTINCT: vd đơn của người bán
  // đi từ `order_items` (nhiều món một đơn) nhưng cần đếm số ĐƠN.
  theo?: { cot: string },
): Promise<TongCoTran> {
  const con = qb
    .clone()
    .select(theo?.cot ?? `${qb.alias}.id`, 'id')
    .distinct(Boolean(theo))
    .orderBy()
    .skip(undefined)
    .take(undefined)
    .offset(undefined)
    .limit(tran + 1);
  const [cau, thamSo] = con.getQueryAndParameters();
  const rows = await qb.connection.query<Array<{ n: string | number }>>(
    `SELECT COUNT(*) AS n FROM (${cau}) dem`,
    thamSo,
  );
  const n = Number(rows[0]?.n ?? 0);
  return { total: Math.min(n, tran), capped: n > tran };
}

/**
 * Một trang của danh sách công khai: áp trần độ sâu, lấy dòng, rồi mới quyết
 * có cần đếm hay không.
 *
 * Không đếm khi chính trang vừa lấy đã nói được tổng: trang chưa đầy (và
 * không phải trang rỗng giữa chừng) thì tổng = vị trí bắt đầu + số dòng nhận
 * về. Đúng mẹo TypeORM `findAndCount` vẫn làm; viết lại ở đây vì ta không còn
 * gọi `findAndCount` nữa.
 */
export async function trangCoTran<R>(o: {
  offset: number;
  size: number;
  layDong: (take: number) => Promise<R[]>;
  dem: () => Promise<TongCoTran>;
  tran?: number;
}): Promise<{ rows: R[] } & TongCoTran> {
  const tran = o.tran ?? MAX_PAGINATION_DEPTH;
  const doSau = catDoSau({ offset: o.offset, size: o.size }, tran);
  const rows = doSau.ngoaiTran ? [] : await o.layDong(doSau.take);
  if (
    !doSau.ngoaiTran &&
    rows.length < doSau.take &&
    (o.offset === 0 || rows.length > 0)
  ) {
    return { rows, total: o.offset + rows.length, capped: false };
  }
  return { rows, ...(await o.dem()) };
}

/**
 * `meta` chuẩn của danh sách. `total_capped` CHỈ xuất hiện khi tổng bị chặn
 * ở trần, để mọi phản hồi thường giữ nguyên khuôn cũ từng byte.
 */
export function metaCoTran(
  current: number,
  pageSize: number,
  tong: TongCoTran,
): PaginationMetaDto {
  return {
    current,
    pageSize,
    pages: Math.ceil(tong.total / pageSize),
    total: tong.total,
    ...(tong.capped ? { total_capped: true } : {}),
  };
}
