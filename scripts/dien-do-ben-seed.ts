/**
 * Điền thẻ Độ bền MẪU cho tin seed (`doBenMau`, src/catalog/products/do-ben-mau.ts).
 *
 *   npm run seed:do-ben                    # xem trước, KHÔNG ghi
 *   npm run seed:do-ben -- --ghi           # ghi thật
 *   npm run seed:do-ben -- --lui --ghi     # đường lùi: xoá đúng thẻ script đã ghi
 *   npm run seed:do-ben -- --bo-1m         # bỏ qua tin dữ liệu thử sp-1m-*
 *   npm run seed:do-ben -- --lo=2000       # cỡ lô, mặc định 5000
 *
 * Nối database theo DB_* trong .env như các script seed. Mặc định là xem trước:
 * script ghi vào bảng đang phục vụ trang công khai, phải gõ thêm chữ mới ghi.
 *
 * CHỈ GHI VÀO DÒNG CÒN `NULL`: thẻ người bán đã khai không bị đè, và chạy lại
 * sau khi đứt giữa chừng chỉ làm phần còn thiếu.
 *
 * ĐƯỜNG LÙI SO TỪNG DÒNG. `doBenMau` tất định theo id, nên `--lui` tính lại mẫu
 * và chỉ xoá dòng còn ĐÚNG mẫu đó; thẻ người bán sửa sau khi điền thì giữ.
 *
 * GHÉP QUA JSON_TABLE, KHÔNG `CASE id WHEN ...`. Bản đầu dùng CASE 5000 nhánh: mỗi
 * dòng dò tuyến tính qua 5000 nhánh, tức 25 triệu phép so mỗi lô; đo trên DB 1
 * triệu dòng ở máy dev, tốc độ tụt từ 1000 xuống 250 dòng/giây. JSON_TABLE gửi
 * cả lô thành một mảng và nối theo khoá chính.
 *
 * THEO LÔ KHOÁ CHÍNH, `updated_at = updated_at`. Prod có hơn 1 triệu tin và DB
 * ở máy khác qua đường hầm SSH: một câu UPDATE cả bảng giữ khoá hàng triệu dòng
 * cả phút; câu theo lô id chạm 5000 dòng mỗi lần. Thiếu vế `updated_at` thì
 * MySQL đẩy ngày sửa của mọi tin lên lúc chạy script, sitemap báo cả triệu
 * trang vừa đổi.
 */
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { doBenMau } from '../src/catalog/products/do-ben-mau';

config();

const GHI = process.argv.includes('--ghi');
const LUI = process.argv.includes('--lui');
const BO_1M = process.argv.includes('--bo-1m');
const LO = Number(
  process.argv.find((a) => a.startsWith('--lo='))?.split('=')[1] ?? 5000,
);

interface Dong {
  id: number;
  condition: string;
  slug: string | null;
}

async function main(): Promise<void> {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'zoldify',
    synchronize: false,
  });
  await ds.initialize();
  console.log(
    `${LUI ? 'LÙI' : 'ĐIỀN'} ${GHI ? 'GHI THẬT' : 'xem trước'} trên ${ds.options.database as string}, lô ${LO}${BO_1M ? ', bỏ sp-1m-*' : ''}`,
  );

  let sau = 0;
  let duyet = 0;
  let doi = 0;
  const batDau = Date.now();
  try {
    for (;;) {
      const dong: Dong[] = await ds.query(
        `SELECT p.id, p.\`condition\` AS \`condition\`, c.slug
           FROM products p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id > ? AND p.deleted_at IS NULL
            AND p.condition_details IS ${LUI ? 'NOT NULL' : 'NULL'}
            ${BO_1M ? "AND p.slug NOT LIKE 'sp-1m-%'" : ''}
          ORDER BY p.id LIMIT ?`,
        [sau, LO],
      );
      if (dong.length === 0) break;
      sau = Number(dong[dong.length - 1].id);
      duyet += dong.length;

      const lo = JSON.stringify(
        dong.map((d) => ({
          id: Number(d.id),
          d: doBenMau(Number(d.id), d.condition, d.slug ?? ''),
        })),
      );
      const bangLo = `JSON_TABLE(?, '$[*]' COLUMNS (id INT PATH '$.id', d JSON PATH '$.d')) v`;

      if (!GHI) {
        if (duyet === dong.length) {
          for (const d of dong.slice(0, 3)) {
            console.log(
              d.id,
              d.condition,
              d.slug,
              JSON.stringify(doBenMau(Number(d.id), d.condition, d.slug ?? '')),
            );
          }
        }
        continue;
      }

      const kq: { affectedRows?: number } = LUI
        ? await ds.query(
            `UPDATE products p JOIN ${bangLo} ON v.id = p.id
                SET p.condition_details = NULL, p.updated_at = p.updated_at
              WHERE p.condition_details = v.d`,
            [lo],
          )
        : await ds.query(
            `UPDATE products p JOIN ${bangLo} ON v.id = p.id
                SET p.condition_details = v.d, p.updated_at = p.updated_at
              WHERE p.condition_details IS NULL`,
            [lo],
          );
      doi += kq.affectedRows ?? 0;
      if (duyet % (LO * 20) === 0) {
        console.log(
          `  đã duyệt ${duyet}, đổi ${doi}, tới id ${sau}, ${Math.round((Date.now() - batDau) / 1000)}s`,
        );
      }
    }
  } finally {
    await ds.destroy();
  }
  console.log(
    JSON.stringify({
      che_do: LUI ? 'lui' : 'dien',
      ghi: GHI,
      duyet,
      doi,
      giay: Math.round((Date.now() - batDau) / 1000),
    }),
  );
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
