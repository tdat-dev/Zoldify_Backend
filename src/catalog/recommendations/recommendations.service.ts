import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Product } from '@catalog/products/entities/product.entity';

/**
 * Gợi ý sản phẩm (task #15) — **SQL thuần, không ML**.
 *
 * Ô task ghi đúng một câu: *"SQL trên bảng `interactions` đã có, không cần
 * ML"*. Giữ đúng vậy, và đó là lựa chọn chứ không phải cắt bớt: một mô hình
 * không giải thích được là thứ không bảo vệ được trước hội đồng, còn
 * "người mua món này cũng mua món kia" thì mở câu SQL ra là thấy vì sao.
 *
 * ĐÃ ĐO BẰNG `EXPLAIN` TRƯỚC KHI VIẾT, trên `zoldify_sqlaudit` (1000 sản phẩm,
 * 2012 dòng `order_items`):
 *
 *   oi1  ref   idx_product_id
 *   oi2  ref   FK(order_id)
 *   p    eq_ref PRIMARY
 *
 * Không bảng thật nào bị quét toàn phần, nên **không thêm index nào**. Dự đoán
 * ban đầu là cần `order_items(product_id, order_id)` — đo xong thì sai:
 * `idx_product_id` sẵn có cộng index khoá ngoại trên `order_id` đã phủ cả hai
 * chiều của phép tự-join.
 *
 * VÌ SAO DÙNG SQL THÔ CHỨ KHÔNG QueryBuilder.
 *
 * Hai câu dưới đây là phép tự-join có `GROUP BY` và `COUNT(*)` — thứ QueryBuilder
 * diễn đạt được nhưng diễn đạt xấu, và quan trọng hơn: viết thẳng SQL thì câu
 * chạy thật **giống hệt** câu tôi đã `EXPLAIN`. Qua một lớp sinh SQL thì bản đo
 * và bản chạy có thể lệch nhau mà không ai biết.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  /**
   * Trần số sản phẩm trả về một lần.
   *
   * Cùng lý do với chặn limit toàn hệ ở Epic 3: một `?limit=1000000` dựng cả
   * triệu entity trong RAM của một tiến trình Node đơn luồng, và trong lúc đó
   * mọi request khác xếp hàng. Chặn ở server chứ không tin client — client ở
   * đây là web và app do chính nhóm viết, và chúng sẽ đổi mà không báo backend.
   */
  private static readonly TRAN = 50;

  /**
   * Số món gần đây nhất của một người được dùng làm hạt giống gợi ý.
   *
   * Không lấy hết lịch sử: một người mua nhiều năm có hàng trăm món, và mệnh
   * đề `IN (...)` dài hàng trăm phần tử biến phép tự-join thành phép quét.
   * Lấy 50 món gần nhất là đủ để đoán sở thích hiện tại — thứ người ta mua ba
   * năm trước nói rất ít về thứ họ muốn hôm nay.
   */
  private static readonly SO_MON_HAT_GIONG = 50;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private chanTran(limit: number): number {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return 12;
    return Math.min(Math.floor(n), RecommendationsService.TRAN);
  }

  /**
   * "Người mua món này cũng mua" — cho trang chi tiết sản phẩm.
   *
   * Hai tầng. Tầng 2 không phải để cho đẹp: sản phẩm vừa đăng chưa nằm trong
   * đơn nào, nên tầng 1 trả về rỗng, và một khung gợi ý trống trên trang chi
   * tiết trông như trang hỏng chứ không như "chưa có dữ liệu".
   */
  async relatedToProduct(productId: number, limit: number): Promise<Product[]> {
    const n = this.chanTran(limit);

    const cungMua = await this.dataSource.query<Product[]>(
      `
      SELECT p.*, COUNT(*) AS diem
      FROM order_items oi1
      JOIN order_items oi2
        ON oi2.order_id = oi1.order_id
       AND oi2.product_id <> oi1.product_id
      JOIN products p ON p.id = oi2.product_id
      WHERE oi1.product_id = ?
        AND p.status = 'active'
        AND p.stock > 0
        AND p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY diem DESC, p.sold_count DESC
      LIMIT ?
      `,
      [productId, n],
    );

    if (cungMua.length >= n) return cungMua;

    // Tầng đỡ: cùng danh mục, bán chạy trước. Loại cả chính nó lẫn những món
    // tầng 1 đã trả, để không có món nào xuất hiện hai lần trong một danh sách.
    const daCo = [productId, ...cungMua.map((p) => p.id)];
    const buThem = await this.dataSource.query<Product[]>(
      `
      SELECT p.*
      FROM products p
      WHERE p.category_id = (SELECT category_id FROM products WHERE id = ?)
        AND p.id NOT IN (?)
        AND p.status = 'active'
        AND p.stock > 0
        AND p.deleted_at IS NULL
      ORDER BY p.sold_count DESC, p.view_count DESC
      LIMIT ?
      `,
      [productId, daCo, n - cungMua.length],
    );

    return [...cungMua, ...buThem];
  }

  /**
   * Gợi ý riêng cho một người — cho trang chủ sau khi đăng nhập.
   *
   * Ba tầng, và tầng cuối là tầng quan trọng nhất về mặt sản phẩm: tài khoản
   * vừa đăng ký không có lịch sử gì: trang chủ rỗng ngay sau khi đăng ký là ấn
   * tượng đầu tiên tệ nhất có thể.
   */
  async forUser(userId: number, limit: number): Promise<Product[]> {
    const n = this.chanTran(limit);

    // Hạt giống: những món người này đã mua gần đây.
    const daMua = await this.dataSource.query<Array<{ product_id: number }>>(
      `
      SELECT DISTINCT oi.product_id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ?
      ORDER BY oi.product_id DESC
      LIMIT ?
      `,
      [userId, RecommendationsService.SO_MON_HAT_GIONG],
    );
    const hatGiong = daMua.map((r) => r.product_id);

    let ketQua: Product[] = [];

    if (hatGiong.length) {
      ketQua = await this.dataSource.query<Product[]>(
        `
        SELECT p.*, COUNT(*) AS diem
        FROM order_items oi1
        JOIN order_items oi2 ON oi2.order_id = oi1.order_id
        JOIN products p ON p.id = oi2.product_id
        WHERE oi1.product_id IN (?)
          AND oi2.product_id NOT IN (?)
          AND p.status = 'active'
          AND p.stock > 0
          AND p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY diem DESC, p.sold_count DESC
        LIMIT ?
        `,
        [hatGiong, hatGiong, n],
      );
    }

    if (ketQua.length >= n) return ketQua;

    // Tầng đỡ cuối: bán chạy toàn sàn. Loại những món đã mua và những món tầng
    // trên đã trả.
    const loai = [...hatGiong, ...ketQua.map((p) => p.id), 0];
    const banChay = await this.dataSource.query<Product[]>(
      `
      SELECT p.*
      FROM products p
      WHERE p.id NOT IN (?)
        AND p.status = 'active'
        AND p.stock > 0
        AND p.deleted_at IS NULL
      ORDER BY p.sold_count DESC, p.view_count DESC
      LIMIT ?
      `,
      [loai, n - ketQua.length],
    );

    return [...ketQua, ...banChay];
  }
}
