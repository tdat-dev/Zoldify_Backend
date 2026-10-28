import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `deleted_at` vào index cho các câu ĐẾM và CỘNG nóng (đợt đo thật 1 triệu
 * dòng, 28/10, zoldify_1mall).
 *
 * Mọi entity xoá mềm (`@DeleteDateColumn`) khiến TypeORM tự thêm
 * `deleted_at IS NULL` vào mọi câu. Cột đó không nằm trong index nào, nên một
 * câu COUNT/SUM vốn đọc xong trong index phải về bảng đọc TỪNG dòng. Đo không
 * tải trên 1 triệu dòng mỗi bảng (MySQL 8.4, buffer pool 512M):
 *
 *   COUNT(products) WHERE deleted_at IS NULL            2.052 ms (quét bảng)
 *   COUNT(users)    WHERE deleted_at IS NULL            1.053 ms (quét bảng)
 *   SUM doanh thu (is_paid, status, deleted_at IS NULL)  9.618 ms (722.526 lần về bảng)
 *   product_count theo danh mục (GET /categories)       15.136 ms (941.015 lần về bảng)
 *
 * Dưới 20 kết nối cả bốn quá trần `max_execution_time` 5 s của compose, nên
 * cache 60 giây bọc chúng không bao giờ được ghi: GET /categories,
 * /admin/stats và /orders/stats trả 500 ở MỌI lần gọi.
 *
 * Cách làm giống migration 1788500000000 (đọc chú thích ở đó): ALTER online
 * INPLACE/LOCK=NONE, chờ khoá tối đa 10 giây, bỏ qua index đã có / đã mất để
 * chạy lại được sau một lần hỏng giữa chừng. Thêm trước, xoá sau.
 */

interface IndexMoi {
  table: string;
  name: string;
  cols: string[];
}

const THEM: IndexMoi[] = [
  // Thay idx_category_status_created: cùng phục vụ danh sách theo danh mục
  // (bằng trên ba cột đầu, sắp theo created_at), và đếm product_count ngay
  // trong index.
  {
    table: 'products',
    name: 'idx_category_status_deleted_created',
    cols: ['category_id', 'status', 'deleted_at', 'created_at'],
  },
  { table: 'products', name: 'idx_deleted_at', cols: ['deleted_at'] },
  { table: 'users', name: 'idx_deleted_at', cols: ['deleted_at'] },
  { table: 'orders', name: 'idx_deleted_at', cols: ['deleted_at'] },
  // Thay idx_paid_status_amount: SUM doanh thu đọc xong trong index.
  {
    table: 'orders',
    name: 'idx_paid_status_deleted_amount',
    cols: ['is_paid', 'status', 'deleted_at', 'final_amount'],
  },
];

/** Xoá chỉ khi cái thay thế (theo cột) đã đứng đó. Không cái nào đỡ khoá ngoại. */
const XOA: Array<IndexMoi & { thayBang: string[] }> = [
  {
    table: 'products',
    name: 'idx_category_status_created',
    cols: ['category_id', 'status', 'created_at'],
    thayBang: ['category_id', 'status', 'deleted_at', 'created_at'],
  },
  {
    table: 'orders',
    name: 'idx_paid_status_amount',
    cols: ['is_paid', 'status', 'final_amount'],
    thayBang: ['is_paid', 'status', 'deleted_at', 'final_amount'],
  },
];

const KHOA_ONLINE = 'ALGORITHM=INPLACE, LOCK=NONE';

async function coIndexKhacPhu(
  q: QueryRunner,
  table: string,
  cols: string[],
  tru: string,
): Promise<boolean> {
  const rows = (await q.query(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> ?
      GROUP BY INDEX_NAME`,
    [table, tru],
  )) as Array<{ INDEX_NAME: string; cols: string }>;
  const can = cols.join(',');
  return rows.some((r) => r.cols === can || r.cols.startsWith(can + ','));
}

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

async function alterTheoBang(
  q: QueryRunner,
  menhDe: Array<{ table: string; sql: string }>,
): Promise<void> {
  const theoBang = new Map<string, string[]>();
  for (const m of menhDe) {
    theoBang.set(m.table, [...(theoBang.get(m.table) ?? []), m.sql]);
  }
  for (const [table, ds] of theoBang) {
    await q.query(`ALTER TABLE \`${table}\` ${ds.join(', ')}, ${KHOA_ONLINE}`);
  }
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

export class AddDeletedAtIndexesFor1M1788600000000 implements MigrationInterface {
  name = 'AddDeletedAtIndexesFor1M1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await voiHanChoKhoa(queryRunner, async () => {
      const them: Array<{ table: string; sql: string }> = [];
      for (const i of THEM) {
        if (await dangCo(queryRunner, i.table, i.name)) continue;
        them.push({
          table: i.table,
          sql: `ADD INDEX \`${i.name}\` (${cot(i.cols)})`,
        });
      }
      await alterTheoBang(queryRunner, them);

      const xoa: Array<{ table: string; sql: string }> = [];
      for (const i of XOA) {
        if (!(await dangCo(queryRunner, i.table, i.name))) continue;
        if (!(await coIndexKhacPhu(queryRunner, i.table, i.thayBang, i.name))) {
          throw new Error(
            `Không xoá ${i.table}.${i.name}: chưa có index nào khác phủ ` +
              `(${i.thayBang.join(', ')}).`,
          );
        }
        xoa.push({ table: i.table, sql: `DROP INDEX \`${i.name}\`` });
      }
      await alterTheoBang(queryRunner, xoa);
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await voiHanChoKhoa(queryRunner, async () => {
      const dungLai: Array<{ table: string; sql: string }> = [];
      for (const i of XOA) {
        if (await dangCo(queryRunner, i.table, i.name)) continue;
        dungLai.push({
          table: i.table,
          sql: `ADD INDEX \`${i.name}\` (${cot(i.cols)})`,
        });
      }
      await alterTheoBang(queryRunner, dungLai);

      const go: Array<{ table: string; sql: string }> = [];
      for (const i of THEM) {
        if (!(await dangCo(queryRunner, i.table, i.name))) continue;
        go.push({ table: i.table, sql: `DROP INDEX \`${i.name}\`` });
      }
      await alterTheoBang(queryRunner, go);
    });
  }
}
