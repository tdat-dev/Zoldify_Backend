#!/usr/bin/env node
/**
 * Sinh các trang use case CHI TIẾT (UC01, UC02, ...) vào 05-use-case-diagram.drawio,
 * mỗi trang một nhóm chức năng, có «include» / «extend».
 *
 * Trang đầu (tổng quan) là bản vẽ tay, script giữ nguyên nó và chỉ thay các
 * trang phía sau. Spec ở scripts/drawio-specs/usecase/*.json, mỗi file một trang.
 *
 * Bố cục ba cột: actor | use case gốc | use case được include hoặc extend.
 * Mỗi use case gốc chiếm một dải hàng riêng, use case con nằm trong đúng dải
 * của nó, nên mọi đường nối giữa hai cột đều đi thẳng và không đường nào cắt
 * nhau. Actor nối thẳng tới từng use case gốc, toả ra như hình nan quạt.
 *
 *   node scripts/drawio-usecase.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, escLabel } from './drawio-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = path.join(ROOT, 'scripts', 'drawio-specs', 'usecase');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', '05-use-case-diagram.drawio');

const FONT = 'fontFamily=Helvetica;fontColor=#000000;';
const ST = {
  frame: `shape=umlFrame;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontSize=12;fontStyle=1;verticalAlign=top;align=left;spacingLeft=6;spacingTop=-1;height=26;${FONT}`,
  actor: `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fontSize=12;fontStyle=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=1.2;${FONT}`,
  uc: `ellipse;whiteSpace=wrap;html=1;fontSize=12;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=1.2;spacing=8;${FONT}`,
  assoc: 'edgeStyle=none;html=1;rounded=0;endArrow=none;strokeColor=#000000;strokeWidth=1.2;',
  dep: `edgeStyle=none;html=1;rounded=0;dashed=1;dashPattern=6 4;endArrow=open;endFill=0;endSize=10;strokeColor=#000000;strokeWidth=1;fontSize=11;labelBackgroundColor=#FFFFFF;${FONT}`,
};

// Toạ độ cột và cỡ hình.
const ROW = 92;
const UC_W = 180, UC_H = 62;
const X_ACTOR = 90, X_BASE = 300, X_CHILD = 660, X_SYS = 1000;
const TOP = 80;

function cell(id, value, style, x, y, w, h) {
  return `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

function edge(id, value, style, src, tgt, exit, entry) {
  const pin = (p, [x, y]) => `${p}X=${x};${p}Y=${y};${p}Dx=0;${p}Dy=0;${p}Perimeter=0;`;
  return `<mxCell id="${id}" value="${value}" style="${style}${pin('exit', exit)}${pin('entry', entry)}" edge="1" parent="1" source="${src}" target="${tgt}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

function buildPage(spec) {
  const cells = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;

  // Mỗi use case gốc chiếm max(1, số con) hàng.
  let row = 0;
  const bases = spec.cases.map((c) => {
    const rels = c.rel ?? [];
    const span = Math.max(1, rels.length);
    const first = row;
    row += span;
    return { ...c, rels, first, span };
  });
  const rows = row;
  const yOf = (r) => TOP + r * ROW; // mép trên của hàng r
  const hasSys = bases.some((b) => b.rels.some((r) => r.system));

  const right = (hasSys ? X_SYS + 110 : X_CHILD + UC_W) + 50;
  let bottom = yOf(rows) + 10;
  const title = `${spec.id} - ${spec.title}`;
  // Khung dựng cuối hàm, khi đã biết actor hệ thống bị đẩy xuống tới đâu.
  const frame = () =>
    `<mxCell id="frame" value="${esc(title)}" style="${ST.frame}width=${Math.round(title.length * 7.2 + 40)};" vertex="1" parent="1"><mxGeometry x="40" y="40" width="${right - 40}" height="${bottom - 40}" as="geometry"/></mxCell>`;

  // Actor chính đứng giữa chiều cao các use case gốc.
  const midY = (yOf(0) + yOf(rows)) / 2;
  cells.push(cell('actor', esc(spec.actor), ST.actor, X_ACTOR, midY - 40, 34, 64));

  const systems = new Map(); // nhãn -> { id, rows: [] }

  for (const b of bases) {
    const bid = id('b');
    const by = yOf(b.first) + (b.span * ROW) / 2 - UC_H / 2;
    cells.push(cell(bid, escLabel(b.label), ST.uc, X_BASE, by, UC_W, UC_H));
    // Xuất phát ngang vai chứ không giữa thân: nhãn actor dài (Administrator)
    // tràn sang phải, đường đi xuống dốc nhất sẽ cắt qua chữ nếu bắt đầu thấp hơn.
    cells.push(edge(id('a'), '', ST.assoc, 'actor', bid, [1, 0.25], [0, 0.5]));

    b.rels.forEach((r, i) => {
      const cid = id('c');
      const cy = yOf(b.first + i) + (ROW - UC_H) / 2;
      cells.push(cell(cid, escLabel(r.label), ST.uc, X_CHILD, cy, UC_W, UC_H));
      const tag = esc(`«${r.kind}»`);
      // include: gốc trỏ tới phần bắt buộc. extend: phần tuỳ chọn trỏ về gốc.
      if (r.kind === 'include') cells.push(edge(id('d'), tag, ST.dep, bid, cid, [1, 0.5], [0, 0.5]));
      else cells.push(edge(id('d'), tag, ST.dep, cid, bid, [0, 0.5], [1, 0.5]));
      if (r.system) {
        if (!systems.has(r.system)) systems.set(r.system, { id: id('s'), links: [] });
        systems.get(r.system).links.push({ cid, cy });
      }
    });
  }

  // Actor hệ thống ngoài đứng ở cột phải, ngang hàng trung bình các use case nó
  // tham gia. Hai actor ở hai hàng liền nhau thì đè nhãn lên nhau (UC02: GHN và
  // PayOS cách nhau 92px, nhãn hai dòng cao hơn thế), nên đẩy actor sau xuống
  // cho đủ SYS_GAP. Thứ tự trên dưới giữ nguyên nên đường nối vẫn không cắt nhau.
  const SYS_GAP = 150;
  let prevY = -Infinity;
  const sorted = [...systems].map(([label, s]) => ({ label, ...s, avg: s.links.reduce((t, l) => t + l.cy, 0) / s.links.length + UC_H / 2 })).sort((a, b) => a.avg - b.avg);
  for (const s of sorted) {
    const y = Math.max(s.avg, prevY + SYS_GAP);
    prevY = y;
    cells.push(cell(s.id, escLabel(s.label), ST.actor, X_SYS + 38, y - 40, 34, 64));
    for (const l of s.links) cells.push(edge(id('a'), '', ST.assoc, l.cid, s.id, [1, 0.5], [0, 0.5]));
    bottom = Math.max(bottom, y + 80);
  }
  cells.unshift(frame());

  return { name: title, cells, w: right + 40, h: bottom + 40 };
}

const specs = fs
  .readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(SPEC_DIR, f), 'utf8')));

const pages = specs.map(buildPage);
const body = pages
  .map(
    (p, i) =>
      `  <diagram id="uc${i + 1}" name="${esc(p.name)}">\n    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.ceil(p.w)}" pageHeight="${Math.ceil(p.h)}" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
      p.cells.map((c) => '        ' + c).join('\n') +
      `\n      </root>\n    </mxGraphModel>\n  </diagram>`,
  )
  .join('\n');

// Giữ nguyên trang tổng quan (trang đầu), thay toàn bộ các trang sau nó.
const xml = fs.readFileSync(OUT, 'utf8');
const firstEnd = xml.indexOf('</diagram>') + '</diagram>'.length;
const head = xml.slice(0, firstEnd);
// Theo kiểu xuống dòng của file gốc (CRLF khi lưu từ draw.io trên Windows),
// không thì một file lẫn hai kiểu xuống dòng.
const eol = head.includes('\r\n') ? '\r\n' : '\n';
fs.writeFileSync(OUT, `${head}\n${body}\n</mxfile>\n`.replace(/\r?\n/g, eol));
console.log(`${path.relative(ROOT, OUT)}: tổng quan + ${pages.map((p) => p.name).join(', ')}`);
