#!/usr/bin/env node
/**
 * Mở từng .drawio bằng draw.io THẬT trong Chrome rồi chụp lại thành .png.
 *
 *   npm run drawio:shoot                    # chụp cả bộ
 *   npm run drawio:shoot -- r5 06-activity  # chỉ chụp file khớp tên
 *
 * VÌ SAO CẦN CÁI NÀY
 * `npm run drawio:check` chỉ kiểm được thứ máy đọc được từ XML: cú pháp, id có
 * tồn tại không, tên shape có đúng không. Nó KHÔNG biết một cái nhãn có đang
 * che mất tên trạng thái, hay một đường nối có đang chạy xuyên qua thân một
 * cái ô. Ngày 2026-08-14 bộ kiểm báo 14/14 hợp lệ trong khi bảy sơ đồ có tổng
 * cộng 21 lỗi nhìn thấy bằng mắt — trong đó một ô màn hình bị ghi chú đè lên,
 * mất hẳn khỏi hình. Cú pháp hợp lệ không nói gì về việc hình có đúng.
 *
 * Chạy xong thì MỞ ẢNH RA NHÌN. Script này không tự phát hiện lỗi, nó chỉ
 * biến "phải mở draw.io thủ công 14 lần" thành "mở một thư mục ảnh".
 *
 * PHỤ THUỘC
 * Dùng puppeteer, hiện có trong node_modules vì `@mermaid-js/mermaid-cli` kéo
 * theo — không phải phụ thuộc trực tiếp của project. Nếu sau này bỏ
 * mermaid-cli thì phải `npm i -D puppeteer`.
 *
 * Chrome: mặc định lấy bản puppeteer tự tải; không có thì dò Chrome hệ thống.
 * Ép đường dẫn khác bằng biến môi trường CHROME_PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'system-design', 'drawio');
const OUT = path.join(DIR, 'renders');

let puppeteer;
try {
  const entry = path.join(ROOT, 'node_modules', 'puppeteer', 'lib', 'puppeteer', 'puppeteer.js');
  puppeteer = (await import(pathToFileURL(entry).href)).default;
} catch {
  console.error(
    'Khong nap duoc puppeteer.\n' +
    'No di kem @mermaid-js/mermaid-cli. Chay `npm ci`, hoac `npm i -D puppeteer`.',
  );
  process.exit(1);
}

/** Chrome nào cũng được, miễn mở được app.diagrams.net. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const p = puppeteer.executablePath();
    if (typeof p === 'string' && p && fs.existsSync(p)) return p;
  } catch { /* puppeteer chưa tải browser */ }
  const guesses = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const hit = guesses.find((g) => fs.existsSync(g));
  if (hit) return hit;
  console.error('Khong tim thay Chrome. Dat bien moi truong CHROME_PATH tro toi chrome.exe.');
  process.exit(1);
}

/**
 * Khung bao trong hệ toạ độ của FILE, đọc thẳng từ mxGeometry.
 *
 * Không đo bằng bounding box của SVG trên trang: draw.io vẽ cả nền trang trong
 * cùng một nhóm, nên bbox luôn to bằng cả tờ giấy chứ không phải bằng hình.
 */
function xmlBounds(xml) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const m of xml.matchAll(/<mxGeometry([^>]*)\/?>/g)) {
    const g = m[1];
    const num = (k) => {
      const r = new RegExp(`${k}="(-?[\\d.]+)"`).exec(g);
      return r ? parseFloat(r[1]) : null;
    };
    const x = num('x');
    const y = num('y');
    if (x === null || y === null) continue; // waypoint của cạnh, bỏ qua
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + (num('width') ?? 0));
    y2 = Math.max(y2, y + (num('height') ?? 0));
  }
  return { x1, y1, x2, y2 };
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.drawio') && !f.startsWith('.$'))
  .filter((f) => only.length === 0 || only.some((frag) => f.includes(frag)));

if (files.length === 0) {
  console.error(`Khong co file nao khop: ${only.join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});

let ok = 0;
let fail = 0;

for (const f of files) {
  const xml = fs.readFileSync(path.join(DIR, f), 'utf8');
  const b = xmlBounds(xml);
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 2400, deviceScaleFactor: 2 });
  try {
    await page.goto(
      'https://app.diagrams.net/?splash=0&ui=min&chrome=0&noSaveBtn=1&noExitBtn=1#R' +
        encodeURIComponent(xml),
      { waitUntil: 'domcontentloaded', timeout: 90_000 },
    );
    await page.waitForSelector('svg', { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 9_000)); // chờ canvas vẽ xong

    // draw.io tự chọn mức phóng tuỳ sơ đồ (có cái 100%, có cái 67%), nên toạ độ
    // trong file không phải toạ độ màn hình. Lấy đúng ma trận nó đang dùng.
    const ctm = await page.evaluate(() => {
      const svg = [...document.querySelectorAll('svg')].sort(
        (a, c) => c.getBoundingClientRect().width - a.getBoundingClientRect().width,
      )[0];
      const m = svg.querySelector('g').getScreenCTM();
      return { a: m.a, d: m.d, e: m.e, f: m.f, vw: window.innerWidth, vh: window.innerHeight };
    });

    const PAD = 20;
    const left = Math.max(0, Math.floor(b.x1 * ctm.a + ctm.e - PAD));
    const top = Math.max(0, Math.floor(b.y1 * ctm.d + ctm.f - PAD));
    const clip = {
      x: left,
      y: top,
      width: Math.min(ctm.vw - left, Math.ceil(b.x2 * ctm.a + ctm.e + PAD) - left),
      height: Math.min(ctm.vh - top, Math.ceil(b.y2 * ctm.d + ctm.f + PAD) - top),
    };

    const name = f.replace('.drawio', '.png');
    await page.screenshot({ path: path.join(OUT, name), clip });
    console.log(`  ok    ${name.padEnd(42)} ${clip.width}x${clip.height}`);
    ok += 1;
  } catch (e) {
    console.log(`  LOI   ${f}: ${e.message.split('\n')[0]}`);
    fail += 1;
  }
  await page.close();
}

await browser.close();
console.log(
  `\n${ok} anh trong docs/system-design/drawio/renders/${fail ? `, ${fail} loi` : ''}.\n` +
  'Mo renders/index.html de xem het mot luot — roi NHIN, script nay khong tu bat loi.',
);
process.exit(fail ? 1 : 0);
