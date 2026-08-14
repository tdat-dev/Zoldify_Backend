/**
 * Đổi ảnh danh mục từ hotlink Unsplash sang file tự lưu trong repo frontend.
 *
 * VÌ SAO PHẢI BỎ HOTLINK: chín danh mục đang trỏ thẳng vào images.unsplash.com.
 * Unsplash đổi đường dẫn, chặn hotlink, hay đơn giản là mạng người dùng không
 * ra được — thì cả hàng danh mục trên trang chủ trắng trơn. Repo này đã có luật
 * đó rồi, ghi trong GoogleButton.tsx: "trước đây hotlink svgrepo.com, hỏng là
 * mất luôn hình."
 *
 * CHẠY ĐƯỢC NHIỀU LẦN: chỉ đụng vào dòng nào đang là URL http(s). Danh mục đã
 * trỏ file nội bộ thì bỏ qua, nên chạy lại lần hai không hỏng gì.
 *
 *   npm run categories:relink            # xem trước, KHÔNG ghi
 *   npm run categories:relink -- --write # ghi thật
 *
 * Mặc định là xem trước: đây là script sửa thẳng vào DB, nên phải gõ thêm chữ
 * mới đổi được dữ liệu.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import dataSource from '../src/data-source';

const WRITE = process.argv.includes('--write');

// Thư mục ảnh nằm bên repo frontend, cạnh repo này.
const MEDIA_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'Zoldify_Frontend',
  'public',
  'media',
  'categories',
);

async function main() {
  await dataSource.initialize();

  const rows: Array<{
    id: number;
    name: string;
    slug: string | null;
    image: string | null;
  }> = await dataSource.query(
    'SELECT id, name, slug, image FROM categories ORDER BY id',
  );

  let changed = 0;
  let skipped = 0;
  let missingFile = 0;

  for (const row of rows) {
    if (!row.image || !/^https?:/i.test(row.image)) {
      console.log(
        `  bỏ qua  ${String(row.id).padEnd(3)} ${row.name} — không phải hotlink`,
      );
      skipped++;
      continue;
    }

    const file = `${row.slug || row.id}.webp`;

    // Kiểm file có thật trước khi trỏ vào: đổi DB sang một đường dẫn không tồn
    // tại thì thay một ảnh hỏng bằng một ảnh hỏng khác, mà lần này còn mất luôn
    // URL gốc để quay lại.
    if (!fs.existsSync(path.join(MEDIA_DIR, file))) {
      console.log(
        `  THIẾU   ${String(row.id).padEnd(3)} ${row.name} — chưa có ${file}`,
      );
      missingFile++;
      continue;
    }

    const next = `/media/categories/${file}`;
    console.log(`  đổi     ${String(row.id).padEnd(3)} ${row.name} → ${next}`);

    if (WRITE) {
      await dataSource.query('UPDATE categories SET image = ? WHERE id = ?', [
        next,
        row.id,
      ]);
    }
    changed++;
  }

  console.log(
    `\n${changed} đổi · ${skipped} bỏ qua · ${missingFile} thiếu file` +
      (WRITE ? '' : '\nĐây mới là XEM TRƯỚC. Thêm -- --write để ghi thật.'),
  );

  if (missingFile > 0) {
    console.log(
      'Thiếu file thì tải ảnh về trước, đừng ghi khi còn dòng THIẾU.',
    );
  }

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
