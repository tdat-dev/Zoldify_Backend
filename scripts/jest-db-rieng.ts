import { basename, resolve } from 'path';
import { createConnection } from 'mysql2/promise';

/**
 * Cho mỗi worktree một database jest riêng.
 *
 * `maxWorkers: 1` trong jest.config.js chỉ ngăn các spec của CÙNG một tiến
 * trình giẫm nhau. Hai phiên ở hai worktree vẫn chung `zoldify_test`: ngày
 * 06/11, `npm test` đỏ 5 bài ở `don-nguoi-ban-doi-chieu` và `tim-kiem-cua-so`
 * đúng lúc phiên khác chạy spec sitemap, spec đó `DELETE FROM products` ở
 * beforeAll; chạy lại lúc vắng thì 925 bài xanh. Đo lại: chạy một mình 3/3
 * lượt xanh, có vòng xoá bảng chen vào thì `don-nguoi-ban-doi-chieu` đỏ 3 bài
 * cả 2 lượt.
 *
 * Tên theo worktree chứ không theo lượt chạy: bảng được giữ giữa các lần chạy
 * nên không phải dựng lại, không để lại database rác khi tiến trình bị giết,
 * và hai nhánh khác lược đồ không `synchronize` đè nhau.
 *
 * Nợ: hai tiến trình jest trong CÙNG một worktree vẫn chung database.
 */
export function tenDbRieng(thuMuc: string): string {
  const ten = basename(thuMuc.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  return `zoldify_jest_${ten}`.slice(0, 64);
}

export default async function datDbRieng(): Promise<void> {
  // CI và ai cố ý chọn database thì giữ nguyên lựa chọn đó.
  if (process.env.TEST_DB_NAME) return;

  const ten = tenDbRieng(resolve(__dirname, '..'));
  process.env.TEST_DB_NAME = ten;

  try {
    const ketNoi = await createConnection({
      host: process.env.TEST_DB_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_DB_PORT ?? 3307),
      user: process.env.TEST_DB_USER ?? 'root',
      password: process.env.TEST_DB_PASSWORD ?? 'testpw',
      connectTimeout: 3000,
    });
    await ketNoi.query(
      `CREATE DATABASE IF NOT EXISTS \`${ten}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await ketNoi.end();
  } catch {
    // Bài không cần MySQL vẫn phải chạy được. Bài cần MySQL tự báo lỗi kết nối
    // kèm hướng dẫn `npm run test:db`, rõ hơn báo ở đây.
  }
}
