import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tin cũ đã hết kho mà vẫn `active` thì chuyển `sold`.
 *
 * `catalog/products/status-by-stock.ts` chỉ đổi trạng thái ở những lần ghi kho
 * từ bản này về sau. Tin bán hết TRƯỚC đó (staging 12/11: i885, i1173 và
 * nhiều tin seed "HẾT HÀNG") vẫn `active`, vẫn nằm đầu trang chủ và vẫn được
 * shop đếm là "đang bán".
 *
 * Chỉ đổi `active` + `stock <= 0`. Tin nháp hay bị ẩn vì khoá người bán giữ
 * nguyên. Không có chiều ngược `sold` + còn kho: việc đó chỉ xảy ra khi dữ liệu
 * đã lệch, để người xem quyết định chứ không tự mở bán lại.
 *
 * THEO LÔ. Prod có ~1 triệu tin; một câu UPDATE gom hết sẽ giữ khoá dòng lâu
 * trong khi người dùng đang đặt hàng (đặt hàng khoá dòng sản phẩm FOR UPDATE).
 * Mỗi lô `batchSize` dòng, lặp tới khi không còn dòng nào khớp. Không ALTER,
 * không đụng cột trong FULLTEXT nên không dựng lại index (bẫy 06/11).
 *
 * Chiều lùi không làm gì: không còn biết tin nào là `sold` do migration và tin
 * nào do bán hết sau đó.
 */
export class MarkSoldOutProducts1789500000000 implements MigrationInterface {
  name = 'MarkSoldOutProducts1789500000000';

  constructor(private readonly batchSize = 5000) {}

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (;;) {
      const result = (await queryRunner.query(
        "UPDATE `products` SET `status` = 'sold' WHERE `status` = 'active' AND `stock` <= 0 LIMIT ?",
        [this.batchSize],
      )) as { affectedRows?: number };
      if (!result?.affectedRows) break;
    }
  }

  public async down(): Promise<void> {
    // Cố ý không hạ lại: xem chú thích đầu file.
  }
}
