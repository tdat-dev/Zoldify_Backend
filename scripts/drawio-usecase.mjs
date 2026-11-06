#!/usr/bin/env node
/**
 * Sinh 05-use-case-diagram.drawio: trang tổng quan và các trang CHI TIẾT (UC01,
 * UC02, ...), mỗi trang chi tiết một nhóm chức năng, có «include» / «extend».
 *
 * Trang tổng quan vẽ ngang 16:9 để chiếu được trên slide (xem buildOverview).
 * Spec trang chi tiết ở scripts/drawio-specs/usecase/*.json, mỗi file một trang.
 * Mỗi use case gốc có thể ghi `actor` riêng, không ghi thì lấy `actor` của trang.
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
  gen: 'edgeStyle=none;html=1;rounded=0;endArrow=block;endFill=0;endSize=14;strokeColor=#000000;strokeWidth=1.2;',
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

  // Mỗi actor đứng giữa chiều cao các use case gốc của nó. Use case của một
  // actor phải nằm liền nhau trong spec, nếu không đường nối sẽ cắt nhau.
  const actorOf = (b) => b.actor ?? spec.actor;
  const actors = [...new Set(bases.map(actorOf))].map((name, i) => {
    const mine = bases.filter((b) => actorOf(b) === name);
    const last = mine[mine.length - 1];
    return { name, id: i === 0 ? 'actor' : `actor${i + 1}`, midY: (yOf(mine[0].first) + yOf(last.first + last.span)) / 2 };
  });
  for (const a of actors) cells.push(cell(a.id, esc(a.name), ST.actor, X_ACTOR, a.midY - 40, 34, 64));
  const actorId = (b) => actors.find((a) => a.name === actorOf(b)).id;
  // Actor đứng dưới là trường hợp riêng của actor đứng trên (User kế thừa Guest).
  for (let i = 1; i < actors.length; i++) {
    cells.push(edge(id('g'), '', ST.gen, actors[i].id, actors[i - 1].id, [0.5, 0], [0.5, 1.45]));
  }

  const systems = new Map(); // nhãn -> { id, rows: [] }

  for (const b of bases) {
    const bid = id('b');
    const by = yOf(b.first) + (b.span * ROW) / 2 - UC_H / 2;
    cells.push(cell(bid, escLabel(b.label), ST.uc, X_BASE, by, UC_W, UC_H));
    // Xuất phát ngang vai chứ không giữa thân: nhãn actor dài (Administrator)
    // tràn sang phải, đường đi xuống dốc nhất sẽ cắt qua chữ nếu bắt đầu thấp hơn.
    cells.push(edge(id('a'), '', ST.assoc, actorId(b), bid, [1, 0.25], [0, 0.5]));

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

/**
 * Trang tổng quan, tỉ lệ khoảng 16:9 và chữ lớn để đọc được khi chiếu.
 *
 * Actor đứng giữa, toả sang hai bên: Guest và User nối cả hai cột, Seller nối
 * cột trái, Buyer nối cột phải, Administrator ở mép phải có cột riêng. Nhờ vậy
 * mọi đường đều thẳng, không cắt nhau và không xuyên qua hình nào.
 */
function buildOverview() {
  const FS = 21;
  const uc = `ellipse;whiteSpace=wrap;html=1;fontSize=${FS};fontStyle=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=1.2;spacing=2;${FONT}`;
  const actor = `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fontSize=${FS};fontStyle=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=1.4;${FONT}`;
  const dep = ST.dep.replace('fontSize=11', 'fontSize=18');
  const W = 270, H = 54, PITCH = 68, Y0 = 24;
  const X_L = 20, X_R = 760, X_RR = 1150;
  const yRow = (r) => Y0 + r * PITCH;
  const cells = [];
  let n = 0;
  const put = (key, label, x, row) => {
    cells.push(cell(key, escLabel(label), uc, x, yRow(row), W, H));
    return key;
  };
  const man = (key, label, cx, top) => cells.push(cell(key, esc(label), actor, cx - 20, top, 40, 76));
  const link = (from, to, exit, entry, style = ST.assoc, value = '') => cells.push(edge(`e${++n}`, value, style, from, to, exit, entry));
  const L = [0, 0.5], R = [1, 0.5];

  man('guest', 'Guest', 525, 22);
  man('user', 'User', 525, 170);
  man('seller', 'Seller', 415, 430);
  man('buyer', 'Buyer', 635, 430);
  man('admin', 'Administrator', 1610, 200);
  link('user', 'guest', [0.5, 0], [0.5, 1.42], ST.gen);
  link('seller', 'user', [0.5, 0], [0.5, 1.42], ST.gen);
  link('buyer', 'user', [0.5, 0], [0.5, 1.42], ST.gen);

  const fan = (who, side, items) => {
    for (const [label, row, x] of items) {
      const key = `uc${++n}`;
      put(key, label, x, row);
      if (side === 'left') link(who, key, [0, 0.25], R);
      else link(who, key, [1, 0.25], L);
    }
  };
  fan('guest', 'left', [['Register an account', 0, X_L], ['Sign in', 1, X_L]]);
  fan('guest', 'right', [['Browse & search items', 0, X_R], ['View item details', 1, X_R]]);
  fan('user', 'left', [['Manage profile', 2, X_L]]);
  fan('user', 'right', [['Exchange messages', 2, X_R]]);
  fan('seller', 'left', [
    ['List an item for sale', 3.4, X_L], ['Manage sales orders', 4.8, X_L], ['Cancel a sale', 6.2, X_L],
    ['View wallet history', 7.6, X_L], ['Request a withdrawal', 9, X_L],
  ]);
  fan('buyer', 'right', [
    ['Manage cart', 3, X_R], ['Place an order', 4, X_R], ['Top up wallet', 5, X_R], ['Track an order', 6, X_R],
    ['Cancel an order', 7, X_R],
  ]);
  put('confirm', 'Confirm delivery', X_R, 8);
  link('buyer', 'confirm', [1, 0.25], L);
  fan('buyer', 'right', [['Review a product', 9, X_R]]);

  const admin = [['Review withdrawals', 0.6], ['Manage users', 2], ['Moderate listings', 3.4], ['Reconcile the ledger', 4.8]];
  for (const [label, row] of admin) {
    const key = `uc${++n}`;
    put(key, label, X_RR, row);
    link('admin', key, [0, 0.25], R);
  }
  put('refund', 'Issue a refund', X_RR, 6.2);
  link('admin', 'refund', [0, 0.25], R);
  put('escrow', 'Manage escrow funds', X_RR, 8);
  link('refund', 'escrow', [0.5, 1], [0.5, 0], dep, esc('«include»'));
  link('confirm', 'escrow', R, L, dep, esc('«include»'));
  return { name: 'Use Case Diagram', cells, w: 1720, h: yRow(10) + 14 };
}

const specs = fs
  .readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(SPEC_DIR, f), 'utf8')));

const pages = [buildOverview(), ...specs.map(buildPage)];
const body = pages
  .map(
    (p, i) =>
      `  <diagram id="uc${i + 1}" name="${esc(p.name)}">\n    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.ceil(p.w)}" pageHeight="${Math.ceil(p.h)}" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
      p.cells.map((c) => '        ' + c).join('\n') +
      `\n      </root>\n    </mxGraphModel>\n  </diagram>`,
  )
  .join('\n');

// Giữ phần mở đầu của file, thay toàn bộ các trang.
const xml = fs.readFileSync(OUT, 'utf8');
const head = xml.slice(0, xml.indexOf('<diagram')).trimEnd();
// Theo kiểu xuống dòng của file gốc (CRLF khi lưu từ draw.io trên Windows),
// không thì một file lẫn hai kiểu xuống dòng.
const eol = head.includes('\r\n') ? '\r\n' : '\n';
fs.writeFileSync(OUT, `${head}\n${body}\n</mxfile>\n`.replace(/\r?\n/g, eol));
console.log(`${path.relative(ROOT, OUT)}: ${pages.map((p) => p.name).join(', ')}`);
