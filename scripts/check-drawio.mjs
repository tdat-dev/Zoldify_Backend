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
  const bareAmp = xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/g);
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

  // 4. Entity lồng nhau — dấu hiệu escape hai lần, nhãn sẽ hiện ra chữ &lt;
  const doubled = xml.match(/&amp;(?:lt|gt|amp|quot);/g);
  if (doubled) {
    report(file, `${doubled.length} chỗ escape hai lần, nhãn sẽ hiện ra &lt; thay vì <`);
  }

  // 3. Mọi id được tham chiếu phải tồn tại
  const ids = new Set([...xml.matchAll(/<mxCell id="([^"]+)"/g)].map((m) => m[1]));
  ids.add('0');
  ids.add('1');
  for (const attr of ['parent', 'source', 'target']) {
    const re = new RegExp(`${attr}="([^"]+)"`, 'g');
    for (const m of xml.matchAll(re)) {
      if (!ids.has(m[1])) report(file, `${attr}="${m[1]}" trỏ vào id không tồn tại`);
    }
  }

  // 4. Tên shape phải là shape draw.io biết
  for (const m of xml.matchAll(/shape=([a-zA-Z0-9_]+)/g)) {
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
