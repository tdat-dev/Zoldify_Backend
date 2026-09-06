// Bánh cóc cho nợ lint.
//
// Cùng một ý với scripts/check-boundaries.mjs, cho một món nợ khác.
//
// VÌ SAO KHÔNG CHẶN THẲNG BẰNG `eslint` TRẦN.
//
// Đo lúc dựng CI: 1008 vấn đề (943 lỗi + 65 cảnh báo) trên 120 file. Bật cổng
// chặn thẳng thì CI đỏ ngay từ commit đầu và đỏ mãi — mà một CI đỏ vĩnh viễn
// còn tệ hơn không có CI: cả nhóm học được cách nhìn dấu X rồi bấm merge.
// deploy.yml đã gặp đúng bài này và chọn `continue-on-error` (xem ghi chú ở đó).
//
// VÌ SAO KHÔNG CHẠY `--fix` TRONG CI.
//
// 462/1008 là prettier/prettier, tức thuần định dạng và tự sửa được. Nhưng
// `--fix` trên runner nghĩa là CI sửa file rồi vẫn thoát 0: xanh giả, nợ vẫn
// nguyên trong repo, và không ai biết. Còn chạy --fix rồi commit ngược lại thì
// là một diff chạm 120 file — thứ phải làm bằng một PR riêng, cố ý, không phải
// tác dụng phụ của việc dựng CI.
//
// NÊN: đếm và không cho tăng.
//
// Mỗi lần sửa được nợ, hạ BASELINE xuống. Về 0 thì xoá file này và cho
// `lint:check` gọi thẳng eslint.
import { ESLint } from 'eslint';

// Đo ngày 2026-08-31, Node 24, trên staging sau khi gộp PR #18 + #19.
// Mốc cũ 979 (đo 25/08). Hai PR đó viết lại chat.service.ts nên dọn kèm 13
// vấn đề; hạ mốc ngay để 13 chỗ ấy không lặng lẽ mọc lại — bánh cóc chỉ có
// tác dụng khi ai đó chịu vặn nó xuống sau mỗi lần sửa.
const BASELINE = 966;

const eslint = new ESLint();
const results = await eslint.lintFiles(['{src,apps,libs,test}/**/*.ts']);

let errors = 0;
let warnings = 0;
const byRule = new Map();

for (const file of results) {
  for (const m of file.messages) {
    // boundaries/* có bánh cóc RIÊNG ở check-boundaries.mjs. Đếm ở cả hai chỗ
    // thì sửa một vi phạm phải hạ hai mốc, và mốc nào cũng nói dối một nửa.
    if (m.ruleId?.startsWith('boundaries/')) continue;

    if (m.severity === 2) errors++;
    else warnings++;

    const key = m.ruleId ?? '(khong ro rule)';
    byRule.set(key, (byRule.get(key) ?? 0) + 1);
  }
}

const count = errors + warnings;

console.log(`Nợ lint: ${count} (${errors} lỗi + ${warnings} cảnh báo) — mốc cho phép: ${BASELINE}`);
console.log('Không tính boundaries/* — món đó có mốc riêng ở check-boundaries.mjs.');

const top = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
if (top.length > 0) {
  console.log('\n5 rule nhiều nhất:');
  for (const [rule, n] of top) console.log(`  ${String(n).padStart(4)}  ${rule}`);
}

if (count > BASELINE) {
  console.error(
    `\nCó ${count - BASELINE} vấn đề lint MỚI so với mốc. Sửa chúng, hoặc nếu ` +
      `thật sự cần thì nói rõ lý do trong PR trước khi nâng mốc.\n`,
  );
  // In ĐÚNG chỗ hỏng. Danh sách 1008 dòng thì không ai đọc, nên chỉ in file có
  // vấn đề kèm số lượng — đủ để biết đi đâu mà xem.
  const byFile = results
    .map((f) => ({
      path: f.filePath,
      n: f.messages.filter((m) => !m.ruleId?.startsWith('boundaries/')).length,
    }))
    .filter((f) => f.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 15);
  for (const f of byFile) console.error(`  ${String(f.n).padStart(4)}  ${f.path}`);
  console.error('\nXem chi tiết: npx eslint "{src,apps,libs,test}/**/*.ts"');
  process.exit(1);
}

if (count < BASELINE) {
  console.log(
    `\nĐã sửa bớt ${BASELINE - count} vấn đề. Hạ BASELINE trong ` +
      `scripts/check-lint.mjs xuống ${count} để giữ mức mới.`,
  );
}
