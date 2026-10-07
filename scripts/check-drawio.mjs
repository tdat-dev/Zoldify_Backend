#!/usr/bin/env node
/**
 * Kiểm file .drawio trước khi giao cho nhóm.
 *
 * Không mở được draw.io ở đây, nên kiểm những thứ máy kiểm được: XML có hợp
 * lệ không, cạnh có trỏ vào id không tồn tại không, con có nằm trong cha có
 * thật không, và tên shape có nằm trong danh sách draw.io hiểu không. Sai một
 * trong bốn thứ đó thì file mở ra là trống hoặc mất hình.
 *
 *   node scripts/check-drawio.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'system-design', 'drawio');

/** Shape draw.io dựng sẵn mà bộ sinh có dùng. Gõ sai tên thì ra hộp trắng. */
const KNOWN_SHAPES = new Set([
  'umlActor', 'umlLifeline', 'umlFrame', 'note', 'cube', 'module',
  'endState', 'startState', 'process', 'table', 'partialRectangle',
  // `line` là shape dựng sẵn của draw.io (một đường kẻ ngang), dùng làm vạch
  // ngăn trong sequence diagram. Thiếu nó trong danh sách nên bộ kiểm báo 30
  // lỗi giả trên một file hoàn toàn lành.
  'line',
  // Shape stencil (tên có dấu chấm) — draw.io nạp từ thư viện hình rời.
  // `flowchart.or` là vòng tròn có dấu X, dùng làm flow final của UML.
  'mxgraph.flowchart.or',
]);

/** Kiểu mũi tên hợp lệ mà bộ sinh có dùng */
const KNOWN_ARROWS = new Set([
  'none', 'block', 'open', 'oval', 'diamond', 'diamondThin', 'classic',
  'ERone', 'ERmany', 'ERzeroToMany', 'ERoneToMany', 'ERzeroToOne', 'ERmandOne',
]);

let problems = 0;
const report = (file, msg) => {
  problems += 1;
  console.error(`  LOI  ${file}: ${msg}`);
};

if (!fs.existsSync(DIR)) {
  console.error(`Không thấy ${DIR}. Chạy: node scripts/make-drawio.mjs`);
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.drawio')).sort();
if (!files.length) {
  console.error('Không có file .drawio nào.');
  process.exit(1);
}

// ĐỦ SỐ SƠ ĐỒ CHƯA — mục này sinh ra vì bộ kiểm từng XANH GIẢ.
//
// Chuyện đã xảy ra: commit 839e3df (24/08) xoá 17 file `.drawio` trong lúc
// thêm nội dung cho `05-use-case-diagram`. Bộ kiểm chỉ duyệt NHỮNG FILE ĐANG
// CÓ, nên nó vẫn báo "3 file hợp lệ, 0 lỗi" — xanh trơn tru trong khi 17/20
// sơ đồ đã biến mất. Cái đang thiếu thì vòng lặp không chạm tới bao giờ.
//
// 20 ảnh PNG vẫn còn trong renders/, nên nhìn thư mục ảnh cũng không thấy
// thiếu gì. Chỉ lúc cần SỬA một sơ đồ mới phát hiện không còn nguồn để mở.
//
// Danh sách lấy từ CHÍNH `make-drawio.mjs` chứ không chép tay: chép tay thì
// thêm sơ đồ mới vào bộ sinh mà quên cập nhật ở đây là bộ kiểm lại mù tiếp.
const GENERATOR = path.join(ROOT, 'scripts', 'make-drawio.mjs');
if (fs.existsSync(GENERATOR)) {
  const nguon = fs.readFileSync(GENERATOR, 'utf8');
  const canCo = [...new Set([...nguon.matchAll(/'([\w.-]+\.drawio)'/g)].map((m) => m[1]))];
  const thieu = canCo.filter((f) => !files.includes(f));
  for (const f of thieu) {
    report(f, 'bộ sinh khai file này mà thư mục không có — chạy `node scripts/make-drawio.mjs`');
  }
  console.log(
    `  Bộ sinh khai ${canCo.length} sơ đồ · thư mục có ${files.length} file · ` +
      (thieu.length ? `\x1b[31mthiếu ${thieu.length}\x1b[0m` : 'không thiếu'),
  );
}

for (const file of files) {
  const xml = fs.readFileSync(path.join(DIR, file), 'utf8');

  // 1. Thẻ đóng mở có cân không. Không có parser XML trong Node nên đếm thẻ.
  const opens = (xml.match(/<mxCell\b/g) || []).length;
  const closes =
    (xml.match(/<\/mxCell>/g) || []).length + (xml.match(/<mxCell\b[^>]*\/>/g) || []).length;
  if (opens !== closes) {
    report(file, `thẻ mxCell lệch: ${opens} mở, ${closes} đóng`);
  }

  // 2. Ký tự & chưa escape sẽ làm draw.io từ chối mở file
  // `#x[0-9a-fA-F]+;` chứ không chỉ `#\d+;`: XML cho phép tham chiếu ký tự
  // viết theo HỆ THẬP LỤC, và draw.io dùng đúng dạng đó cho ký tự xuống dòng
  // trong nhãn (`&#xa;`). Bản trước chỉ nhận hệ thập phân nên báo 42 lỗi giả
  // "dấu & chưa escape" trên một file escape đúng chuẩn.
  const bareAmp = xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g);
  if (bareAmp) {
    report(file, `${bareAmp.length} dấu & chưa escape`);
  }

  // 3. Dấu < thô BÊN TRONG một thuộc tính. Đây là lỗi đã từng lọt: nhãn nhiều
  //    dòng được ghi thành <br> thật, XML hỏng, draw.io báo "Not a diagram
  //    file" và không mở được gì. Bộ kiểm cũ chỉ soi dấu & nên cho qua.
  for (const m of xml.matchAll(/\s(?:value|style)="([^"]*)"/g)) {
    if (m[1].includes('<')) {
      const snippet = m[1].slice(Math.max(0, m[1].indexOf('<') - 25), m[1].indexOf('<') + 25);
      report(file, `dấu < thô trong thuộc tính: …${snippet}…`);
    }
  }

  // 4. Thẻ HTML bị escape hai lần: nhãn hiện ra chữ "<br>" thay vì xuống dòng.
  //    Chỉ bắt THẺ. `&amp;amp;` hay `&amp;lt;` đứng một mình là cách draw.io tự
  //    lưu dấu & và < gõ trong nhãn html=1, file mở ra vẫn hiển thị đúng; bắt
  //    chúng thì mọi file vừa lưu từ draw.io đều bị báo sai.
  const doubled = xml.match(/&amp;lt;\/?(?:br|div|b|i|u|span|font|p|sup|sub)\b/gi);
  if (doubled) {
    report(file, `${doubled.length} thẻ HTML escape hai lần, nhãn sẽ hiện ra chữ &lt;br&gt;`);
  }

  // 3. Mọi id được tham chiếu phải tồn tại
  //
  // GOM ID TỪ MỌI THẺ VÀ MỌI VỊ TRÍ THUỘC TÍNH, không chỉ `<mxCell id="…"`.
  //
  // Bản trước đòi `id` phải là thuộc tính ĐẦU TIÊN và phải nằm trên thẻ
  // `mxCell`. Hai giả định đó đều sai với file người vẽ tay trong draw.io:
  //
  //   <UserObject label="" mermaidData="…" id="izsMoZBKHS00p62MVDwI-1">
  //
  // draw.io bọc mọi hình sinh từ mermaid trong `<UserObject>`, và nó xếp
  // thuộc tính theo bảng chữ cái nên `id` rơi xuống cuối. Kết quả: 560 lỗi
  // giả "trỏ vào id không tồn tại" trên `Sequence-Diagrams.drawio` — một file
  // 14 trang hoàn toàn lành. Đếm thử: 452 thẻ `<mxCell` mà chỉ 153 cái được
  // bản cũ nhìn thấy.
  //
  // Một bộ kiểm báo sai hàng loạt thì cũng vô dụng như bộ kiểm luôn xanh:
  // cả nhóm học cách bỏ qua nó, rồi lỗi thật đi lọt cùng đám lỗi giả.
  const ids = new Set(
    [...xml.matchAll(/<(?:mxCell|object|UserObject)\b[^>]*?\sid="([^"]+)"/g)].map(
      (m) => m[1],
    ),
  );
  ids.add('0');
  ids.add('1');
  for (const attr of ['parent', 'source', 'target']) {
    const re = new RegExp(`${attr}="([^"]+)"`, 'g');
    for (const m of xml.matchAll(re)) {
      if (!ids.has(m[1])) report(file, `${attr}="${m[1]}" trỏ vào id không tồn tại`);
    }
  }

  // 4. Tên shape phải là shape draw.io biết
  // Dấu chấm phải nằm trong tên bắt được: shape stencil tên dạng
  // `mxgraph.flowchart.or`, cắt ở dấu chấm thì tên nào cũng thành "mxgraph"
  // và bộ kiểm báo sai cho mọi shape thư viện.
  for (const m of xml.matchAll(/shape=([a-zA-Z0-9_.]+)/g)) {
    if (!KNOWN_SHAPES.has(m[1])) report(file, `shape=${m[1]} không nằm trong danh sách đã biết`);
  }

  // 5. Kiểu mũi tên
  for (const m of xml.matchAll(/(?:endArrow|startArrow)=([a-zA-Z]+)/g)) {
    if (!KNOWN_ARROWS.has(m[1])) report(file, `mũi tên "${m[1]}" không hợp lệ`);
  }

  // 6. Mỗi vertex phải có mxGeometry, nếu không draw.io đặt nó ở góc 0,0
  const vertices = [...xml.matchAll(/<mxCell[^>]*vertex="1"[^>]*>([\s\S]*?)<\/mxCell>/g)];
  const noGeo = vertices.filter((v) => !v[1].includes('<mxGeometry')).length;
  if (noGeo) report(file, `${noGeo} vertex thiếu mxGeometry`);

  // 7. Phải có ít nhất một diagram và một vertex
  if (!/<diagram\b/.test(xml)) report(file, 'không có thẻ <diagram>');
  if (!vertices.length) report(file, 'không có hình nào');

  const cellCount = ids.size - 2;
  const edges = (xml.match(/edge="1"/g) || []).length;
  const name = (xml.match(/<diagram[^>]*name="([^"]+)"/) || [])[1] || '?';
  console.log(
    `  ${problems === 0 ? 'OK ' : '   '} ${file.padEnd(42)} ${String(cellCount).padStart(3)} ô · ` +
      `${String(edges).padStart(2)} cạnh · "${name}"`,
  );
}

console.log(
  problems === 0
    ? `\n${files.length} file hợp lệ, 0 lỗi.`
    : `\n${problems} lỗi. Sửa rồi chạy lại.`,
);
process.exit(problems === 0 ? 0 : 1);
