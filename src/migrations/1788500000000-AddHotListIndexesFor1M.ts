import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index cho các câu NÓNG khi bảng lên cỡ triệu dòng (đợt rà 28/10: "nạp ~1
 * triệu dòng thì backend có sập không").
 *
 * Kết luận đợt rà: MySQL không sập, nhưng API trượt dần thành timeout, vì các
 * câu danh sách nóng nhất chỉ có index phủ NỬA: lọc được `status` nhưng không
 * có cột sắp xếp đi kèm. MySQL phải gom hết hàng `active` (~80% bảng) rồi
 * filesort chỉ để lấy 20 dòng đầu trang.
 *
 * ĐO TRƯỚC, KHÔNG ĐOÁN. Số trước/sau đo bằng `scripts/explain-1m.ts` trên
 * zoldify_1mb (200k sản phẩm, 100k đơn, 100k vận đơn, 100k tin nhắn, 100k ký
 * quỹ, 50k người dùng), chạy chính `down()` rồi `up()` của file này. Bảng số
 * đầy đủ in ra khi chạy script; tóm tắt nằm cạnh từng index bên dưới.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * VÌ SAO KHÔNG VIẾT `CREATE INDEX` TRƠN NHƯ CÁC MIGRATION TRƯỚC.
 *
 * Các migration trước chạy lúc bảng còn vài nghìn dòng. File này nhắm đúng
 * lúc bảng đã lớn và đang có người dùng, nên ba chốt:
 *
 * 1. `ALGORITHM=INPLACE, LOCK=NONE`: MySQL 8 dựng index phụ tại chỗ, không
 *    chép lại bảng, và vẫn cho INSERT/UPDATE chạy trong lúc dựng. Ghi rõ ra
 *    thay vì để MySQL tự chọn: nếu vì lý do nào đó nó KHÔNG làm được online
 *    (vd bảng có kiểu cột lạ), câu lệnh báo lỗi ngay chứ không âm thầm rơi về
 *    `LOCK=SHARED` và chặn ghi cả bảng trong vài chục giây.
 *
 * 2. `lock_wait_timeout = 10` trong phiên này. Kể cả online DDL vẫn cần một
 *    metadata lock ngắn lúc bắt đầu và lúc kết thúc. Nếu có một transaction
 *    dài đang giữ bảng (vd job huỷ đơn), ALTER phải chờ. Mặc định MySQL
 *    chờ 31.536.000 giây (một năm). Tệ hơn chờ: mọi câu SELECT tới SAU xếp
 *    hàng phía sau ALTER đang chờ, nên cả trang chủ đứng hình theo. Mười giây
 *    rồi báo lỗi thì deploy hỏng và chạy lại được, còn site không treo.
 *
 * 3. `up()` bỏ qua index ĐÃ có, `down()` bỏ qua index ĐÃ mất. Một lần chạy
 *    hỏng giữa chừng (chính chốt số 2 có thể gây ra) để lại một nửa số index;
 *    TypeORM không ghi migration vào bảng `migrations` khi hỏng, nên lần chạy
 *    lại sẽ gặp `Duplicate key name` ở index đầu tiên và kẹt mãi. Kiểm trước
 *    khi tạo thì chạy lại là đi tiếp từ chỗ dừng.
 *
 * Mỗi bảng gộp mọi ADD/DROP vào MỘT câu ALTER: MySQL quét bảng một lượt cho
 * cả loạt index thay vì năm lượt cho năm index của `products`.
 */

interface IndexMoi {
  table: string;
  name: string;
  cols: string[];
}

/** Index thêm mới. Cột nào, vì câu nào: xem chú thích từng dòng. */
const THEM: IndexMoi[] = [
  // Trang chủ và mọi danh sách sản phẩm công khai: WHERE status='active'
  // ORDER BY <một trong bốn cột>. Một index cho mỗi kiểu sắp xếp, vì index
  // chỉ khử filesort được khi cột sắp đứng NGAY SAU cột lọc bằng.
  {
    table: 'products',
    name: 'idx_status_created',
    cols: ['status', 'created_at'],
  },
  { table: 'products', name: 'idx_status_price', cols: ['status', 'price'] },
  {
    table: 'products',
    name: 'idx_status_sold',
    cols: ['status', 'sold_count'],
  },
  {
    table: 'products',
    name: 'idx_status_view',
    cols: ['status', 'view_count'],
  },
  // Bấm vào một danh mục: WHERE category_id=? AND status='active' ORDER BY
  // created_at. Chỉ phủ kiểu sắp mặc định; danh mục × bốn kiểu sắp là thêm ba
  // index nữa cho các trang ít người mở hơn, chưa đáng tiền ghi.
  {
    table: 'products',
    name: 'idx_category_status_created',
    cols: ['category_id', 'status', 'created_at'],
  },
  // Bảng quản trị lọc đơn theo trạng thái, mới nhất trước.
  {
    table: 'orders',
    name: 'idx_status_created',
    cols: ['status', 'created_at'],
  },
  // Job tự xác nhận nhận hàng (orders.autoConfirmDueShipments):
  //   status='delivered' AND received_at IS NULL AND delivered_at < mốc
  // Hai cột bằng trước (MySQL coi IS NULL là phép bằng khi đi index), cột
  // khoảng `delivered_at` cuối cùng; đảo thứ tự là chỉ dùng được hai cột.
  {
    table: 'order_shipments',
    name: 'idx_status_received_delivered',
    cols: ['status', 'received_at', 'delivered_at'],
  },
  // Chấm đỏ "tin chưa đọc": conversation_id IN (...) AND is_read=0 AND
  // sender_id <> tôi. Có đủ ba cột thì MySQL đếm xong ngay trong index
  // ("Using index"), không phải lần về bảng đọc cột `content` kiểu TEXT.
  {
    table: 'messages',
    name: 'idx_conversation_read_sender',
    cols: ['conversation_id', 'is_read', 'sender_id'],
  },
  // Danh sách người dùng của admin, mới đăng ký trước.
  { table: 'users', name: 'idx_created_at', cols: ['created_at'] },
  // Danh sách ký quỹ của admin lọc trạng thái. Bảng này chưa có index nào
  // trên created_at cả.
  {
    table: 'escrows',
    name: 'idx_status_created',
    cols: ['status', 'created_at'],
  },
];

/**
 * Index XOÁ, kèm dãy cột mà một index KHÁC phải phủ để thay nó (so theo cột
 * chứ không theo tên: tên băm của TypeORM không phải thứ nên tin là giống
 * nhau giữa các môi trường). Xoá chỉ chạy khi cái thay thế
 * ĐÃ có, đúng bài học của migration 1788000000000: MySQL từ chối xoá index
 * đang đỡ khoá ngoại nếu không còn index nào khác bắt đầu bằng cột đó.
 */
const XOA: Array<IndexMoi & { thayBang: string[] }> = [
  // Trùng hẳn index UNIQUE trên (email) mà TypeORM sinh từ `unique: true`
  // (tên băm `IDX_97672ac88f789774dd47f7c8be` ở InitialSchema). Optimizer
  // luôn chọn cái UNIQUE, nên cái này chỉ tốn một lần ghi B-tree mỗi khi
  // tạo/sửa email. users.email không có khoá ngoại nào trỏ vào.
  {
    table: 'users',
    name: 'idx_email',
    cols: ['email'],
    thayBang: ['email'],
  },
  // Tiền tố trái của idx_wallet_created (wallet_id, created_at). Khoá ngoại
  // wallet_id → wallets chuyển sang đứng trên idx_wallet_created; đã kiểm
  // bằng SHOW CREATE TABLE sau khi chạy (scripts/explain-1m.ts in ra).
  {
    table: 'wallet_transactions',
    name: 'idx_wallet',
    cols: ['wallet_id'],
    thayBang: ['wallet_id', 'created_at'],
  },
  // Tiền tố trái của idx_status_created vừa thêm ở trên. `status` không có
  // khoá ngoại. Giữ lại là ghi thêm một B-tree mỗi lần đổi trạng thái tin.
  {
    table: 'products',
    name: 'idx_status',
    cols: ['status'],
    thayBang: ['status', 'created_at'],
  },
];

// KHÔNG xoá `products.idx_category_id` dù nó cũng là tiền tố trái của
// idx_category_status_created. Lý do là `synchronize` của TypeORM (chỉ chạy
// lúc test): nó xoá index cũ TRƯỚC rồi mới tạo index mới, nên trên database
// test dựng từ entity cũ MySQL sẽ từ chối với "needed in a foreign key
// constraint" (category_id có khoá ngoại), đúng lỗi đã làm đỏ 71 bài kiểm
// lần trước. idx_wallet ở trên thì an toàn vì cái thay nó đã có từ trước.

const KHOA_ONLINE = 'ALGORITHM=INPLACE, LOCK=NONE';

/** Có index nào KHÁC `tru` bắt đầu đúng bằng dãy cột `cols` không. */
async function coIndexKhacPhu(
  q: QueryRunner,
  table: string,
  cols: string[],
  tru: string,
): Promise<boolean> {
  const rows: Array<{ INDEX_NAME: string; cols: string }> = await q.query(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> ?
      GROUP BY INDEX_NAME`,
    [table, tru],
  );
  const can = cols.join(',');
  return rows.some((r) => r.cols === can || r.cols.startsWith(can + ','));
}

async function dangCo(
  q: QueryRunner,
  table: string,
  name: string,
): Promise<boolean> {
  const rows: unknown[] = await q.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [table, name],
  );
  return rows.length > 0;
}

/** Chạy một câu ALTER cho mỗi bảng, gom mọi mệnh đề của bảng đó. */
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
  const [{ cu }]: Array<{ cu: number }> = await q.query(
    'SELECT @@SESSION.lock_wait_timeout AS cu',
  );
  await q.query('SET SESSION lock_wait_timeout = 10');
  try {
    await viec();
  } finally {
    await q.query(`SET SESSION lock_wait_timeout = ${Number(cu)}`);
  }
}

const cot = (cols: string[]) => cols.map((c) => `\`${c}\``).join(', ');

export class AddHotListIndexesFor1M1788500000000 implements MigrationInterface {
  name = 'AddHotListIndexesFor1M1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await voiHanChoKhoa(queryRunner, async () => {
      // THÊM TRƯỚC, XOÁ SAU: idx_status chỉ được xoá khi idx_status_created
      // đã đứng đó (xem XOA).
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
              `(${i.thayBang.join(', ')}). Xoá lúc này là để khoá ngoại và ` +
              'truy vấn mất index đỡ.',
          );
        }
        xoa.push({ table: i.table, sql: `DROP INDEX \`${i.name}\`` });
      }
      await alterTheoBang(queryRunner, xoa);
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await voiHanChoKhoa(queryRunner, async () => {
      // Ngược thứ tự của up(): dựng lại cái đã xoá TRƯỚC, rồi mới gỡ cái mới
      // (để idx_status có lại trước khi idx_status_created biến mất).
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
