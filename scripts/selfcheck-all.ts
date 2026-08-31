/**
 * CỔNG CHẤT LƯỢNG TỔNG — chạy TẤT CẢ bộ tự kiểm bằng 1 lệnh.
 *
 * Mỗi Epic có một file tự kiểm riêng (in PASS/FAIL, thoát mã ≠0 khi hỏng). File
 * này gọi lần lượt cả bộ, tổng hợp kết quả và thoát mã 1 nếu BẤT KỲ cái nào FAIL
 * — tiện nghiệm thu toàn dự án hoặc cắm vào CI.
 *
 *   npm run check
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

const suites: Array<{ name: string; file: string }> = [
  // Đặt ĐẦU vì đây là suite duy nhất KHÔNG cần database: nó chỉ đọc ci.yml và
  // package.json. Hỏng cấu hình thì biết ngay trong một giây, không phải đợi
  // ba suite database chạy xong mới lộ.
  { name: 'Task #4 — hợp đồng CI (không cần DB)', file: 'selfcheck-ci.ts' },
  // Cũng không cần database — chỉ đọc file, chỉ mục git, và chạy thử phần dọn
  // file cũ trên một thư mục giả. Đặt ngay sau CI vì cùng tính chất: rẻ, và
  // hỏng thì phải biết trước khi đợi ba suite database.
  { name: 'Task #24/#25 — backup + khôi phục (không cần DB)', file: 'selfcheck-backup.ts' },
  // Cần Redis (không cần MySQL). Đặt ngay sau CI vì cùng nhóm hạ tầng, và vì
  // nó dựng hai server socket thật nên hỏng ở đây là hỏng thứ rất đáng biết
  // trước khi chạy ba suite database.
  { name: 'Task #5 — trạng thái dùng chung qua Redis', file: 'selfcheck-redis-state.ts' },
  // Cần Redis chứ KHÔNG cần database. Đặt ngay sau suite CI vì cùng loại: hỏng
  // là hỏng cấu hình, biết sớm hơn ba suite database phía dưới.
  { name: 'Task #14 — worker tách khỏi API (cần Redis + DB)', file: 'selfcheck-worker.ts' },
  { name: 'Epic 0/1/2 — dữ liệu sạch + phân trang + keyset', file: 'selfcheck.ts' },
  { name: 'Epic 3 — index (hết filesort)', file: 'selfcheck-indexes.ts' },
  // Cần schema thật (đủ 25 bảng + index của migration), không phải schema do
  // jest synchronize dựng. Xem bước 'Dựng schema thật để soi' trong ci.yml.
  { name: 'Đua — 20 người bấm cùng lúc', file: 'selfcheck-race.ts' },
  { name: 'Epic 4 — cache (hit==DB, không stale, fail-open)', file: 'selfcheck-cache.ts' },
];

const scriptsDir = __dirname;
const results: Array<{ name: string; code: number }> = [];

for (const s of suites) {
  console.log(`\n\x1b[1m\x1b[36m▶ ${s.name}\x1b[0m`);
  const r = spawnSync(
    process.execPath,
    [
      '-r',
      'ts-node/register',
      '-r',
      'tsconfig-paths/register',
      path.join(scriptsDir, s.file),
    ],
    { stdio: 'inherit' },
  );
  results.push({ name: s.name, code: r.status ?? 1 });
}

console.log('\n\x1b[1m═══ TỔNG KẾT CỔNG CHẤT LƯỢNG ═══\x1b[0m');
let anyFail = false;
for (const r of results) {
  if (r.code === 0) {
    console.log(`  \x1b[32m✓ PASS\x1b[0m  ${r.name}`);
  } else {
    anyFail = true;
    console.log(`  \x1b[31m✗ FAIL (mã ${r.code})\x1b[0m  ${r.name}`);
  }
}
console.log(
  anyFail
    ? '\n\x1b[31m═══ CÓ SUITE FAIL — xem chi tiết phía trên ═══\x1b[0m'
    : '\n\x1b[32m═══ TẤT CẢ SUITE PASS ✓ ═══\x1b[0m',
);
process.exit(anyFail ? 1 : 0);
