import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index phủ cho "đơn của người bán" (`GET /orders?as=seller`) ở cỡ 1 triệu
 * dòng (đo 02/11 trên zoldify_1mall, MySQL 8.4, buffer pool 512M).
 *
 * Câu đi products(seller_id) -> order_items(product_id) -> orders(id), và ở
 * cả ba chặng đều phải về bảng đọc TỪNG dòng: `deleted_at` của sản phẩm,
 * `order_id` của dòng hàng, `deleted_at`/`created_at` của đơn. Sản phẩm của
 * một người bán rải khắp bảng (id cách nhau), nên 10.000 sản phẩm là gần
 * 10.000 trang dữ liệu khác nhau, rồi 20.000 dòng hàng, rồi 20.000 đơn. Ba
 * bảng ~750M dữ liệu không nằm vừa buffer pool 512M:
 *
 *   trước (lạnh)  7.123 ms     trước (ấm)  258 ms
 *   sau   (lạnh)    934 ms     sau   (ấm)  165 ms
 *
 * Dưới tải trước khi sửa: p95 5.467 ms khi một người gọi, 500 ở 20 kết nối
 * (quá trần max_execution_time 5 s).
 *
 * VÌ SAO INDEX BẮT ĐẦU BẰNG `id` TRÊN orders. Đơn được tra theo khoá chính
 * (`o.id = i.order_id`), mà khoá chính của InnoDB là chính dòng dữ liệu: tra
 * theo nó là đọc cả dòng (~200 byte, rải khắp 197M). Index (id, deleted_at,
 * status, created_at) chứa đúng những cột câu này cần, ~25M, nằm gọn trong
 * buffer pool. Optimizer vẫn thích PRIMARY cho phép so bằng trên khoá duy
 * nhất, nên OrdersService.findAll gợi ý bằng `USE INDEX` (đo: không gợi ý thì
 * vẫn đi PRIMARY, lạnh 5.077 ms).
 *
 * GIỮ `idx_product_id` (product_id) dù `idx_product_order` cùng tiền tố:
 * entity OrderItem khai báo nó và check:drift so lược đồ với entity. Gỡ được
 * khi sửa cả entity, đổi lại vài MB index và một lần ghi index mỗi dòng hàng.
 *
 * Cách làm như migration 1788600000000: ALTER online INPLACE/LOCK=NONE, chờ
 * khoá tối đa 10 giây, bỏ qua index đã có / đã mất để chạy lại được.
 * Dựng trên 1 triệu dòng mỗi bảng: ~18 giây cho cả ba.
 */

interface IndexMoi {
  table: string;
  name: string;
  cols: string[];
}

const THEM: IndexMoi[] = [
  {
    table: 'products',
    name: 'idx_seller_deleted',
    cols: ['seller_id', 'deleted_at'],
  },
  {
    table: 'order_items',
    name: 'idx_product_order',
    cols: ['product_id', 'order_id'],
  },
  {
    table: 'orders',
    name: 'idx_id_deleted_status_created',
    cols: ['id', 'deleted_at', 'status', 'created_at'],
  },
];

const KHOA_ONLINE = 'ALGORITHM=INPLACE, LOCK=NONE';

async function dangCo(
  q: QueryRunner,
  table: string,
  name: string,
): Promise<boolean> {
  const rows = (await q.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [table, name],
  )) as unknown[];
  return rows.length > 0;
}

async function voiHanChoKhoa(
  q: QueryRunner,
  viec: () => Promise<void>,
): Promise<void> {
  const [{ cu }] = (await q.query(
    'SELECT @@SESSION.lock_wait_timeout AS cu',
  )) as Array<{ cu: number }>;
  await q.query('SET SESSION lock_wait_timeout = 10');
  try {
    await viec();
  } finally {
    await q.query(`SET SESSION lock_wait_timeout = ${Number(cu)}`);
  }
}

const cot = (cols: string[]) => cols.map((c) => `\`${c}\``).join(', ');

export class AddSellerOrderIndexesFor1M1788700000000 implements MigrationInterface {
  name = 'AddSellerOrderIndexesFor1M1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await voiHanChoKhoa(queryRunner, async () => {
      for (const i of THEM) {
        if (await dangCo(queryRunner, i.table, i.name)) continue;
        await queryRunner.query(
          `ALTER TABLE \`${i.table}\` ADD INDEX \`${i.name}\` (${cot(i.cols)}), ${KHOA_ONLINE}`,
        );
      }
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await voiHanChoKhoa(queryRunner, async () => {
      for (const i of THEM) {
        if (!(await dangCo(queryRunner, i.table, i.name))) continue;
        await queryRunner.query(
          `ALTER TABLE \`${i.table}\` DROP INDEX \`${i.name}\`, ${KHOA_ONLINE}`,
        );
      }
    });
  }
}
