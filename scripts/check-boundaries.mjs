// Bánh cóc cho ranh giới nghiệp vụ.
//
// Code hiện còn một số chỗ import sai chiều giữa 6 nhóm. Sửa hết ngay thì
// phải làm luôn phần ledger, nên tạm chấp nhận — nhưng KHÔNG cho phép
// tăng thêm. Script này đếm vi phạm và fail nếu vượt mốc.
//
// Mỗi lần sửa được vi phạm, hạ BASELINE xuống. Khi về 0 thì đổi luật
// trong eslint.config.mjs sang 'error' và xoá file này.
import { ESLint } from 'eslint';

const BASELINE = 29;

const eslint = new ESLint();
const results = await eslint.lintFiles(['src/**/*.ts']);

const violations = [];
for (const file of results) {
  for (const m of file.messages) {
    if (m.ruleId?.startsWith('boundaries/')) {
      violations.push(`${file.filePath}:${m.line}  ${m.message}`);
    }
  }
}

const count = violations.length;
console.log(`Vi phạm ranh giới: ${count} (mốc cho phép: ${BASELINE})`);

if (count > BASELINE) {
  console.error(
    `\nCó ${count - BASELINE} vi phạm MỚI. Một nhóm nghiệp vụ chỉ được ` +
      `import xuống dưới, xem sơ đồ ở docs/system-design.\n`,
  );
  violations.forEach((v) => console.error('  ' + v));
  process.exit(1);
}

if (count < BASELINE) {
  console.log(
    `\nĐã sửa bớt ${BASELINE - count} vi phạm. Hạ BASELINE trong ` +
      `scripts/check-boundaries.mjs xuống ${count} để giữ mức mới.`,
  );
}
