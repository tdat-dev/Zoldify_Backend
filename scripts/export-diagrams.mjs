#!/usr/bin/env node
/**
 * Xuất mọi sơ đồ Mermaid trong docs/system-design ra ảnh.
 *
 * Thông báo capstone cấm chụp màn hình sơ đồ trong báo cáo và slide, nên
 * ảnh phải được render đàng hoàng. Chạy được script này cũng đồng nghĩa
 * mọi khối Mermaid trong repo đều hợp lệ cú pháp — đó là lý do có chế độ
 * --check để CI dùng.
 *
 *   node scripts/export-diagrams.mjs           # xuất SVG + PNG
 *   node scripts/export-diagrams.mjs --check   # chỉ kiểm cú pháp, không giữ ảnh
 *
 * Chrome: script tự dò các đường dẫn quen thuộc trên Windows/macOS/Linux.
 * Máy nào để Chrome chỗ khác thì đặt PUPPETEER_EXECUTABLE_PATH.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'docs', 'system-design');
const OUT_DIR = path.join(DOCS_DIR, 'exports');
const CHECK_ONLY = process.argv.includes('--check');

/** Đường dẫn Chrome thường gặp, theo thứ tự ưu tiên */
const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Không tìm thấy vẫn chạy tiếp: puppeteer có thể đã tải Chromium riêng.
  // Nếu cả hai đều không có thì mmdc sẽ báo lỗi rõ ràng hơn ta.
  return null;
}

/** Biến tiêu đề thành tên file an toàn, bỏ dấu tiếng Việt */
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Tách các khối mermaid khỏi một file markdown.
 *
 * Đặt tên theo tiêu đề `##` gần nhất phía trên, vì tiêu đề là thứ người
 * viết báo cáo tra cứu — "AD-02" dễ tìm hơn "diagram-7".
 */
function extractBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let heading = 'untitled';
  let inBlock = false;
  let buffer = [];
  let startLine = 0;
  let seq = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlock && /^#{1,3}\s/.test(line)) {
      heading = line.replace(/^#+\s*/, '').trim();
      continue;
    }

    if (!inBlock && /^```mermaid\s*$/.test(line)) {
      inBlock = true;
      buffer = [];
      startLine = i + 1;
      continue;
    }

    if (inBlock && /^```\s*$/.test(line)) {
      inBlock = false;
      seq += 1;
      blocks.push({
        name: `${String(seq).padStart(2, '0')}-${slugify(heading)}`,
        code: buffer.join('\n'),
        line: startLine,
        heading,
      });
      continue;
    }

    if (inBlock) buffer.push(line);
  }

  if (inBlock) {
    throw new Error(`Khối \`\`\`mermaid mở ở dòng ${startLine} mà không đóng`);
  }

  return blocks;
}

function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`Không thấy thư mục ${DOCS_DIR}`);
    process.exit(1);
  }

  const mdFiles = fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const chrome = findChrome();
  console.log(
    chrome ? `Chrome: ${chrome}` : 'Chrome: dùng bản puppeteer tự tải',
  );

  // mmdc mặc định chạy Chrome không sandbox được trên CI Linux chạy bằng root
  const puppeteerConfig = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'zoldify-mmd-')),
    'puppeteer.json',
  );
  fs.writeFileSync(
    puppeteerConfig,
    JSON.stringify({ args: ['--no-sandbox', '--disable-gpu'] }),
  );

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoldify-diagrams-'));
  const outBase = CHECK_ONLY ? workDir : OUT_DIR;
  if (!CHECK_ONLY) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Gọi thẳng file JS bằng node, KHÔNG qua node_modules/.bin/mmdc.cmd.
  // Từ Node 18.20 trở đi, execFile không spawn được .cmd và trả EINVAL trên
  // Windows. Đi thẳng vào entry point thì chạy giống nhau ở mọi hệ điều hành.
  const mmdc = path.join(
    ROOT,
    'node_modules',
    '@mermaid-js',
    'mermaid-cli',
    'src',
    'cli.js',
  );
  if (!fs.existsSync(mmdc)) {
    console.error(
      'Chưa cài @mermaid-js/mermaid-cli. Chạy: npm i -D @mermaid-js/mermaid-cli',
    );
    process.exit(1);
  }

  const failures = [];
  const index = [];
  let rendered = 0;

  for (const file of mdFiles) {
    const markdown = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
    let blocks;
    try {
      blocks = extractBlocks(markdown);
    } catch (err) {
      failures.push({ file, name: '-', message: err.message });
      continue;
    }
    if (!blocks.length) continue;

    const filePrefix = slugify(file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''));
    const targetDir = CHECK_ONLY ? outBase : path.join(OUT_DIR, filePrefix);
    if (!CHECK_ONLY) fs.mkdirSync(targetDir, { recursive: true });

    console.log(`\n${file} — ${blocks.length} sơ đồ`);

    for (const block of blocks) {
      const src = path.join(workDir, `${filePrefix}-${block.name}.mmd`);
      fs.writeFileSync(src, block.code, 'utf8');

      // Ghi kèm bản .mmd rời để dán thẳng vào draw.io:
      //   draw.io  →  + (Insert)  →  Advanced  →  Mermaid...
      // draw.io dựng lại thành hình khối sửa được, không phải ảnh dán vào.
      if (!CHECK_ONLY) {
        fs.writeFileSync(
          path.join(targetDir, `${block.name}.mmd`),
          block.code,
          'utf8',
        );
      }

      // SVG cho Word (nét ở mọi cỡ in), PNG 2x cho PowerPoint
      const targets = CHECK_ONLY
        ? [{ ext: 'svg', extra: [] }]
        : [
            { ext: 'svg', extra: [] },
            { ext: 'png', extra: ['--scale', '2', '--backgroundColor', 'white'] },
          ];

      let ok = true;
      for (const target of targets) {
        const out = path.join(targetDir, `${block.name}.${target.ext}`);
        try {
          execFileSync(
            process.execPath,
            [
              mmdc,
              '-i', src,
              '-o', out,
              '--puppeteerConfigFile', puppeteerConfig,
              ...target.extra,
            ],
            {
              stdio: 'pipe',
              env: chrome
                ? { ...process.env, PUPPETEER_EXECUTABLE_PATH: chrome }
                : process.env,
            },
          );
        } catch (err) {
          ok = false;
          const stderr = (err.stderr?.toString() || err.message).trim();
          failures.push({
            file,
            name: block.name,
            line: block.line,
            message: stderr.split('\n').slice(-6).join('\n'),
          });
          break;
        }
      }

      if (ok) {
        rendered += 1;
        index.push({ dir: filePrefix, name: block.name, heading: block.heading });
        console.log(`  OK  ${block.name}`);
      } else {
        console.log(`  LOI ${block.name}  (dòng ${block.line})`);
      }
    }
  }

  fs.rmSync(workDir, { recursive: true, force: true });

  // Tên file bắt đầu bằng số thứ tự trong markdown, không phải số sơ đồ, nên
  // nhìn tên không đoán được nội dung. Ghi kèm một bảng tra để khỏi phải mở
  // từng ảnh ra xem.
  if (!CHECK_ONLY && index.length) {
    const rows = index
      .map((e) => `| \`${e.dir}/${e.name}\` | ${e.heading} |`)
      .join('\n');
    fs.writeFileSync(
      path.join(OUT_DIR, 'INDEX.md'),
      '# Sơ đồ đã xuất — bảng tra\n\n' +
        '> Sinh tự động bởi `npm run diagrams:export`. Đừng sửa tay.\n\n' +
        'Mỗi sơ đồ có ba file cùng tên: `.svg` cho Word, `.png` (2x) cho\n' +
        'PowerPoint, `.mmd` để dán vào draw.io.\n\n' +
        '| File | Sơ đồ |\n|---|---|\n' +
        rows +
        '\n',
      'utf8',
    );
    console.log(`Bảng tra: ${path.relative(ROOT, path.join(OUT_DIR, 'INDEX.md'))}`);
  }

  console.log(
    `\n${rendered} sơ đồ hợp lệ, ${failures.length} lỗi.` +
      (CHECK_ONLY ? '' : ` Ảnh ở ${path.relative(ROOT, OUT_DIR)}/`),
  );

  if (failures.length) {
    console.error('\nChi tiết lỗi:');
    for (const f of failures) {
      console.error(`\n— ${f.file} :: ${f.name} (dòng ${f.line ?? '?'})`);
      console.error(f.message);
    }
    process.exit(1);
  }
}

main();
