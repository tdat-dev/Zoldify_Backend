/**
 * BỘ TỰ KIỂM LỆCH LƯỢC ĐỒ — entity phải mô tả đúng thứ migration đã dựng.
 *
 * Chạy:
 *   npm run check:drift
 *   (cần lược đồ ĐÃ CHẠY MIGRATION — xem CI, bước "Dựng schema thật để soi")
 *
 * VÌ SAO CẦN MỘT CỔNG RIÊNG CHO VIỆC NÀY.
 *
 * Entity là nguồn mà `migration:generate` và `synchronize` đọc. Migration là
 * thứ thật sự dựng nên database. Khi hai bên lệch nhau thì không ai báo — mã
 * chạy bình thường, test xanh, CI xanh. Nó chỉ nổ vào lúc tệ nhất: lần kế ai
 * đó chạy `migration:generate`, TypeORM sinh ra một migration "sửa" lược đồ
 * theo entity, và nếu entity thiếu thì nó XOÁ thứ đang phục vụ production.
 *
 * Chuyện đó suýt xảy ra thật ở repo này: 10 index composite của
 * AddListOrderingIndexes, Round2 và AddFulltextSearch — thành quả của ba epic
 * tối ưu — chưa bao giờ được khai ở entity. Một lần `migration:generate` là bay
 * hết, và `npm test` vẫn xanh 130/130 trong lúc đó.
 *
 * VÌ SAO ĐẾM SỐ DÒNG CHỨ KHÔNG SO KHỚP NỘI DUNG.
 * `schema:log` trả về đúng danh sách câu lệnh mà TypeORM sẽ chạy để kéo
 * database về khớp entity. Danh sách rỗng = không lệch. Không cần diễn giải
 * thêm; bất kỳ dòng nào cũng là một chỗ hai bên đang kể hai câu chuyện khác
 * nhau, kể cả dòng trông vô hại như đổi `tinyint` thành `tinyint(1)`.
 *
 * NGƯỠNG. Bắt đầu bằng một bánh cóc như `check-lint.mjs`: hôm nay còn bao
 * nhiêu thì ghi bấy nhiêu, và chỉ được giảm. Về 0 thì đổi thành chặn tuyệt đối.
 */
import AppDataSource from '../src/data-source';

/**
 * Số dòng lệch tối đa còn chấp nhận.
 *
 * Đo 24/09/2026 sau khi dọn: 0. Trước đợt dọn là 16 (10 index composite bị
 * entity bỏ quên, 9 cột boolean khai `tinyint` thay vì `boolean`, 2 khoá ngoại
 * lệch tên, 2 cột timestamp thiếu precision).
 *
 * Tăng số này là tự cho phép entity nói dối về database. Nếu buộc phải tăng,
 * ghi lý do ngay dưới đây kèm ngày.
 */
const NGUONG = 0;

async function main() {
  const ds = await AppDataSource.initialize();

  const sqlInMemory = await ds.driver.createSchemaBuilder().log();
  const lech = sqlInMemory.upQueries.map((q) => q.query);

  console.log('\x1b[1m═══ TỰ KIỂM LỆCH LƯỢC ĐỒ ═══\x1b[0m');
  console.log(
    `Lược đồ: ${ds.options.database as string} · ngưỡng cho phép: ${NGUONG}\n`,
  );

  await ds.destroy();

  if (lech.length === 0) {
    console.log(
      '\x1b[1m\x1b[32m═══ KẾT QUẢ: KHÔNG LỆCH ✓ (entity mô tả đúng database) ═══\x1b[0m',
    );
    process.exit(0);
  }

  console.log(`\x1b[1mTypeORM sẽ chạy ${lech.length} câu để kéo DB về khớp entity:\x1b[0m`);
  for (const q of lech) console.log(`  ${q};`);
  console.log('');

  if (lech.length <= NGUONG) {
    console.log(
      `\x1b[33m⚠ ${lech.length} dòng lệch — vẫn trong ngưỡng ${NGUONG}, nhưng đừng để nó ở đó lâu.\x1b[0m`,
    );
    process.exit(0);
  }

  console.log(
    `\x1b[1m\x1b[31m═══ KẾT QUẢ: ${lech.length} DÒNG LỆCH ✗ (ngưỡng ${NGUONG}) ═══\x1b[0m`,
  );
  console.log(
    '\x1b[2mSửa ENTITY cho khớp database nếu migration đúng; viết MIGRATION mới\n' +
      'nếu entity đúng. Đừng hạ ngưỡng để đi qua.\x1b[0m',
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('\x1b[31mLỖI CHẠY TỰ KIỂM LỆCH LƯỢC ĐỒ:\x1b[0m', e);
  process.exit(2);
});
