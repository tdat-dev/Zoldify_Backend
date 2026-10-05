#!/usr/bin/env node
/**
 * Sinh Sequence-Diagrams.drawio từ spec JSON, đúng ký pháp UML 2.5
 * (theo mẫu uml-diagrams.org):
 *
 *   - khung `sd <tên>` bao cả tương tác
 *   - đầu lifeline là hộp chữ nhật `tên : Lớp` (actor là hình người que)
 *   - gọi đồng bộ: nét liền, đầu mũi tên đặc; bất đồng bộ: nét liền, đầu mở;
 *     trả về: nét đứt, đầu mở
 *   - thanh kích hoạt (execution specification) màu xám, tự lồng khi gọi chính nó
 *   - combined fragment alt / opt / loop / break / par có thẻ ngũ giác, guard [..]
 *
 * Toạ độ tính hết bằng tay nên không có đường xiên hay đường vòng. Spec nằm ở
 * scripts/drawio-specs/sequence/*.json, mỗi file một trang, sắp theo tên file.
 *
 *   node scripts/drawio-sequence.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSheet, vertex, edgeAt, buildFile, escLabel } from './drawio-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = path.join(ROOT, 'scripts', 'drawio-specs', 'sequence');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', 'Sequence-Diagrams.drawio');

// ---------------------------------------------------------------- style
const FONT = 'fontFamily=Helvetica;fontColor=#000000;';
const ST = {
  head: `rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;fontSize=12;${FONT}`,
  actor: `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fillColor=#FFFFFF;strokeColor=#000000;fontSize=12;fontStyle=1;${FONT}`,
  life: 'html=1;endArrow=none;dashed=1;dashPattern=6 4;strokeColor=#000000;strokeWidth=1;',
  bar: 'rounded=0;html=1;fillColor=#E6E6E6;strokeColor=#000000;strokeWidth=1;',
  sync: `html=1;endArrow=block;endFill=1;endSize=8;strokeColor=#000000;verticalAlign=bottom;fontSize=11;labelBackgroundColor=#FFFFFF;${FONT}`,
  async: `html=1;endArrow=open;endFill=0;endSize=10;strokeColor=#000000;verticalAlign=bottom;fontSize=11;labelBackgroundColor=#FFFFFF;${FONT}`,
  reply: `html=1;endArrow=open;endFill=0;endSize=10;dashed=1;dashPattern=6 4;strokeColor=#000000;verticalAlign=bottom;fontSize=11;labelBackgroundColor=#FFFFFF;${FONT}`,
  selfLine: 'html=1;endArrow=none;strokeColor=#000000;',
  selfArrow: 'html=1;endArrow=block;endFill=1;endSize=8;strokeColor=#000000;',
  frame: `shape=umlFrame;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontSize=11;fontStyle=1;verticalAlign=top;align=left;spacingLeft=6;spacingTop=-1;${FONT}`,
  sdFrame: `shape=umlFrame;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontSize=12;verticalAlign=top;align=left;spacingLeft=6;spacingTop=-1;${FONT}`,
  sep: 'html=1;endArrow=none;dashed=1;dashPattern=8 4;strokeColor=#000000;',
  text: `text;html=1;align=left;verticalAlign=middle;fontSize=11;whiteSpace=nowrap;${FONT}`,
  selfText: `text;html=1;align=left;verticalAlign=bottom;fontSize=11;whiteSpace=nowrap;${FONT}`,
  note: `shape=note;whiteSpace=wrap;html=1;size=12;align=left;verticalAlign=middle;spacingLeft=8;spacingRight=8;fillColor=#FFFFFF;strokeColor=#000000;fontSize=11;${FONT}`,
  destroy: 'html=1;endArrow=none;strokeColor=#000000;strokeWidth=2;',
};

// ---------------------------------------------------------------- metrics
const textW = (s, size = 11) =>
  Math.max(...String(s).split('\n').map((l) => l.replace(/<[^>]+>/g, '').length)) * size * 0.58 + 8;
const lines = (s) => String(s).split('\n').length;

const BAR = 10;      // execution specification width
const NEST = 6;      // horizontal offset of a nested bar
const ROW = 38;      // vertical step per message
const SELF_H = 22;   // drop of a self message
const MIN_GAP = 150;
const TOP = 70;      // y of lifeline heads

/** All lifeline ids touched by a list of steps (recursively). */
function touched(steps, out = new Set()) {
  for (const s of steps) {
    for (const k of ['from', 'to', 'on']) if (s[k]) out.add(s[k]);
    if (s.over) s.over.forEach((o) => out.add(o));
    if (s.operands) s.operands.forEach((op) => touched(op.steps, out));
  }
  return out;
}
const depthOf = (steps) =>
  Math.max(0, ...steps.filter((s) => s.operands).map((s) => 1 + Math.max(...s.operands.map((o) => depthOf(o.steps)))));

function layoutX(spec) {
  const L = spec.lifelines;
  const idx = Object.fromEntries(L.map((l, i) => [l.id, i]));
  const w = L.map((l) => (l.kind === 'actor' ? Math.max(60, textW(l.label, 12)) : Math.max(110, textW(l.label, 12) + 24)));
  const gaps = L.slice(1).map((_, i) => Math.max(MIN_GAP, (w[i] + w[i + 1]) / 2 + 40));

  const need = []; // [from, to, width]
  const walk = (steps) => {
    for (const s of steps) {
      if (s.msg && s.msg !== 'self' && s.from !== s.to) {
        const a = Math.min(idx[s.from], idx[s.to]), b = Math.max(idx[s.from], idx[s.to]);
        need.push([a, b, textW(s.label) + 36]);
      }
      if (s.msg === 'self') {
        const i = idx[s.on];
        if (i < L.length - 1) need.push([i, i + 1, textW(s.label) + 60]);
      }
      if (s.operands) {
        s.operands.forEach((o) => walk(o.steps));
        const ids = [...touched([s])].map((t) => idx[t]);
        const a = Math.min(...ids), b = Math.max(...ids);
        const guardW = Math.max(...s.operands.map((o) => textW(o.guard || ''))) + 70;
        if (b > a) need.push([a, b, guardW - 60]);
      }
    }
  };
  walk(spec.steps);
  need.sort((p, q) => p[1] - p[0] - (q[1] - q[0]));
  for (const [a, b, width] of need) {
    const have = gaps.slice(a, b).reduce((x, y) => x + y, 0);
    if (have < width) for (let i = a; i < b; i++) gaps[i] += (width - have) / (b - a);
  }
  const x = [40 + w[0] / 2 + 30];
  for (const g of gaps) x.push(x[x.length - 1] + Math.round(g));
  return { idx, w, x: x.map(Math.round) };
}

function render(spec) {
  const sheet = createSheet(spec.name);
  const L = spec.lifelines;
  const { idx, w, x } = layoutX(spec);
  const isActor = (id) => L[idx[id]].kind === 'actor';

  // heads
  const headH = Math.max(...L.map((l) => (l.kind === 'actor' ? 0 : 22 + lines(l.label) * 15)), 40);
  const lineTop = {};
  for (const [i, l] of L.entries()) {
    if (l.kind === 'actor') {
      vertex(sheet, { value: l.label, style: ST.actor, x: x[i] - 15, y: TOP, w: 30, h: headH - 18 });
      lineTop[l.id] = TOP + headH + 2;
    } else {
      vertex(sheet, { value: l.label, style: ST.head, x: x[i] - w[i] / 2, y: TOP, w: w[i], h: headH });
      lineTop[l.id] = TOP + headH;
    }
  }

  // activation bookkeeping
  const stack = Object.fromEntries(L.map((l) => [l.id, []])); // open bars: {y, d}
  const bars = []; // closed: {id, y1, y2, d}
  const open = (id, y) => { if (isActor(id)) return; stack[id].push({ y, d: stack[id].length }); };
  const pop = (id, y) => { const b = stack[id].pop(); if (b) bars.push({ id, y1: b.y, y2: Math.max(y, b.y + 16), d: b.d }); };
  // Bars that were open when a combined fragment started belong to the flow around it:
  // a return inside one operand ends that operand, not the caller's whole execution.
  const guards = []; // [{ protect: Set(bar), closed: Set(bar) }]
  const close = (id, y) => {
    const b = stack[id][stack[id].length - 1];
    if (!b) return;
    const g = [...guards].reverse().find((lv) => lv.protect.has(b));
    if (g) { g.closed.add(b); return; }
    pop(id, y);
  };
  const ensure = (id, y) => { if (!isActor(id) && !stack[id].length) open(id, y); };
  const depth = (id) => Math.max(0, stack[id].length - 1);
  const edgeX = (id, side, d = depth(id)) => {
    if (isActor(id)) return x[idx[id]];
    const left = x[idx[id]] - BAR / 2 + d * NEST;
    return side < 0 ? left : left + BAR;
  };

  const later = []; // cells drawn after bars so arrows sit on top
  const notes = []; // drawn before bars
  let y = TOP + headH + 40;
  const frames = [];

  const run = (steps, level) => {
    for (const s of steps) {
      if (s.msg === 'sync' || s.msg === 'async' || s.msg === 'create') {
        // an idle lifeline that only fires a signal gets a short bar, not one that runs to the end
        if (s.msg === 'async' && !isActor(s.from) && stack[s.from].length === 0) bars.push({ id: s.from, y1: y - 6, y2: y + 18, d: 0 });
        else ensure(s.from, y - 6);
        const dir = x[idx[s.to]] > x[idx[s.from]] ? 1 : -1;
        const x1 = edgeX(s.from, dir);
        let x2;
        if (s.msg === 'async' && stack[s.to].length === 0 && !isActor(s.to)) {
          bars.push({ id: s.to, y1: y, y2: y + 24, d: 0 });
          x2 = edgeX(s.to, -dir, 0);
        } else if (s.msg === 'async') {
          x2 = edgeX(s.to, -dir);
        } else {
          open(s.to, y);
          x2 = edgeX(s.to, -dir);
        }
        later.push(() => edgeAt(sheet, { x1, y1: y0(s), x2, y2: y0(s), value: s.label, style: s.msg === 'sync' ? ST.sync : ST.async }));
        s._y = y;
        y += ROW + (lines(s.label) - 1) * 13;
      } else if (s.msg === 'reply') {
        const dir = x[idx[s.to]] > x[idx[s.from]] ? 1 : -1;
        const x1 = edgeX(s.from, dir), x2 = edgeX(s.to, -dir);
        s._y = y;
        later.push(() => edgeAt(sheet, { x1, y1: y0(s), x2, y2: y0(s), value: s.label, style: ST.reply }));
        close(s.from, y);
        y += ROW + (lines(s.label) - 1) * 13;
      } else if (s.msg === 'self') {
        ensure(s.on, y - 6);
        const xa = edgeX(s.on, 1);
        open(s.on, y + SELF_H - 4);
        const xb = edgeX(s.on, 1);
        const yy = y, out = xa + 28;
        later.push(() => {
          edgeAt(sheet, { x1: xa, y1: yy, x2: out, y2: yy, style: ST.selfLine });
          edgeAt(sheet, { x1: out, y1: yy, x2: out, y2: yy + SELF_H, style: ST.selfLine });
          edgeAt(sheet, { x1: out, y1: yy + SELF_H, x2: xb, y2: yy + SELF_H, style: ST.selfArrow });
          vertex(sheet, { value: s.label, style: ST.selfText, x: out + 6, y: yy - 16, w: textW(s.label), h: 16 + (lines(s.label) - 1) * 13 });
        });
        close(s.on, y + SELF_H + 14);
        y += SELF_H + 34 + (lines(s.label) - 1) * 13;
      } else if (s.msg === 'destroy') {
        const cx = x[idx[s.on]];
        later.push(() => {
          edgeAt(sheet, { x1: cx - 9, y1: y - 9, x2: cx + 9, y2: y + 9, style: ST.destroy });
          edgeAt(sheet, { x1: cx - 9, y1: y + 9, x2: cx + 9, y2: y - 9, style: ST.destroy });
        });
        y += 30;
      } else if (s.note) {
        const ids = (s.over || [s.on]).map((t) => idx[t]);
        const a = Math.min(...ids), b = Math.max(...ids);
        // start just right of the first lifeline's bar so no execution bar runs through the text
        const nx = x[a] + (stack[L[a].id].length ? BAR / 2 + depth(L[a].id) * NEST : 0) + 10;
        const nw = Math.max(textW(s.note) + 24, x[b] - x[a] + 20), nh = 14 + lines(s.note) * 15;
        const yy = y - 12;
        notes.push(() => vertex(sheet, { value: s.note, style: ST.note, x: nx, y: yy, w: nw, h: nh }));
        y += nh + 18;
      } else if (s.ref) {
        const ids = s.over.map((t) => idx[t]);
        const a = Math.min(...ids), b = Math.max(...ids);
        const rp = level > 0 ? 34 : 50;
        const fx = x[a] - rp, fw = x[b] - x[a] + 2 * rp, yy = y - 12;
        later.push(() => {
          vertex(sheet, { value: 'ref', style: ST.frame + 'width=40;height=20;fillColor=#FFFFFF;', x: fx, y: yy, w: fw, h: 44 });
          vertex(sheet, { value: s.ref, style: ST.text + 'align=center;', x: fx + 40, y: yy + 12, w: fw - 80, h: 24 });
        });
        y += 58;
      } else if (s.operands) {
        const ids = [...touched([s])].map((t) => idx[t]);
        const a = Math.min(...ids), b = Math.max(...ids);
        const inner = depthOf(s.operands.flatMap((o) => o.steps));
        const pad = 46 + inner * 12;
        const hasSelfAtB = JSON.stringify(s).includes(`"on":"${L[b].id}"`) && JSON.stringify(s).includes('"msg":"self"');
        const selfExtra = hasSelfAtB
          ? Math.max(...s.operands.flatMap((o) => o.steps).filter((t) => t.msg === 'self').map((t) => textW(t.label) + 40), 0)
          : 0;
        const fx = x[a] - pad;
        const guardW = Math.max(...s.operands.map((o) => textW(o.guard || ''))) + 70;
        const gidEarly = s.guardOn || L[a].id;
        const guardRight = x[idx[gidEarly]] + 20 + Math.max(...s.operands.map((o) => textW(o.guard || ''))) + 12;
        const fw = Math.max(x[b] - x[a] + 2 * pad, guardW, x[b] - x[a] + pad + Math.max(pad, selfExtra), guardRight - fx);
        const fy = y - 14;
        const seps = [];
        const guardTexts = [];
        // guard sits just right of the lifeline that evaluates it (UML 2.5 places it on that lifeline)
        const gid = s.guardOn || L[a].id;
        const gx = () => x[idx[gid]] + (isActor(gid) ? 8 : BAR / 2 + depth(gid) * NEST + 6);
        const base = Object.fromEntries(L.map((l) => [l.id, stack[l.id].length]));
        const lv = { protect: new Set(L.flatMap((l) => stack[l.id])), closed: new Set() };
        const closedPerOperand = [];
        y += 18;
        s.operands.forEach((op, k) => {
          if (k > 0) { seps.push(y - 10); y += 6; }
          if (op.guard) { guardTexts.push([op.guard, gx(), y - 4]); y += 26; }
          lv.closed = new Set();
          guards.push(lv);
          run(op.steps, level + 1);
          guards.pop();
          // bars opened inside this operand end with it
          for (const l of L) while (stack[l.id].length > base[l.id]) pop(l.id, y - 6);
          closedPerOperand.push(lv.closed);
        });
        y -= 10;
        // a bar every alternative returned from is really finished at the end of the fragment
        if (s.frag === 'alt' && s.operands.length > 1) {
          for (const l of L) {
            const top = stack[l.id][stack[l.id].length - 1];
            if (top && closedPerOperand.every((c) => c.has(top))) close(l.id, y - 2);
          }
        }
        const fh = y - fy;
        const tagW = Math.max(46, textW(s.frag, 11) + 22);
        frames.push(() => {
          vertex(sheet, { value: s.frag, style: `${ST.frame}width=${tagW};height=20;`, x: fx, y: fy, w: fw, h: fh });
          for (const sy of seps) edgeAt(sheet, { x1: fx, y1: sy, x2: fx + fw, y2: sy, style: ST.sep });
        });
        later.push(() => {
          for (const [g, gxx, gy] of guardTexts)
            vertex(sheet, { value: g, style: ST.text + 'labelBackgroundColor=#FFFFFF;', x: gxx, y: gy - 8, w: textW(g), h: 16 });
        });
        y += 22;
      } else {
        throw new Error(`${spec.name}: unknown step ${JSON.stringify(s)}`);
      }
    }
  };
  const y0 = (s) => s._y;
  run(spec.steps, 0);

  const end = y + 10;
  for (const l of L) while (stack[l.id].length) close(l.id, end - 10);

  // lifelines, then bars (nested ones last so they sit on top), frames, arrows
  for (const [i, l] of L.entries()) edgeAt(sheet, { x1: x[i], y1: lineTop[l.id], x2: x[i], y2: end + 20, style: ST.life });
  notes.forEach((f) => f());
  bars.sort((p, q) => p.d - q.d);
  for (const b of bars) vertex(sheet, { value: '', style: ST.bar, x: x[idx[b.id]] - BAR / 2 + b.d * NEST, y: b.y1, w: BAR, h: b.y2 - b.y1 });
  frames.forEach((f) => f());
  later.forEach((f) => f());

  // outer sd frame
  const left = x[0] - w[0] / 2 - 24;
  const right = Math.max(...frameRights(sheet), x[x.length - 1] + w[w.length - 1] / 2) + 24;
  const title = `sd ${spec.title || spec.name}`;
  sheet.cells.unshift(
    `<mxCell id="sd" value="${escLabel(title)}" style="${ST.sdFrame}width=${Math.round(textW(title, 12) + 26)};height=24;" vertex="1" parent="1">` +
      `<mxGeometry x="${left}" y="20" width="${right - left}" height="${end + 40}" as="geometry"/></mxCell>`,
  );
  sheet.size = { w: right + 40, h: end + 100 };
  return sheet;
}

/** Right edge of every vertex already placed, so the sd frame encloses notes and fragments. */
function frameRights(sheet) {
  return sheet.cells
    .map((c) => c.match(/<mxGeometry x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/))
    .filter(Boolean)
    .map((m) => Number(m[1]) + Number(m[2]));
}

const files = fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith('.json')).sort();
/**
 * Labels are rendered as HTML (html=1), so text such as `?q=giay&current=1` would turn
 * `&curren` into a currency sign. Escape every user-visible string once, here.
 */
function htmlText(spec) {
  // numeric references: drawio renders them the same, and check-drawio never mistakes them for double escaping
  const h = (t) => String(t).replace(/&/g, '&#38;').replace(/</g, '&#60;').replace(/>/g, '&#62;');
  const walk = (steps) => steps.forEach((st) => {
    for (const k of ['label', 'note', 'ref']) if (typeof st[k] === 'string') st[k] = h(st[k]);
    if (st.operands) st.operands.forEach((o) => { if (o.guard) o.guard = h(o.guard); walk(o.steps); });
  });
  spec.lifelines.forEach((l) => (l.label = h(l.label)));
  walk(spec.steps);
  return spec;
}

const sheets = files.map((f) => render(htmlText(JSON.parse(fs.readFileSync(path.join(SPEC_DIR, f), 'utf8')))));
const W = Math.max(...sheets.map((s) => s.size.w)), H = Math.max(...sheets.map((s) => s.size.h));
fs.writeFileSync(OUT, buildFile(sheets, { width: Math.ceil(W), height: Math.ceil(H) }));
console.log(`${OUT}: ${sheets.length} trang (${sheets.map((s) => s.name).join(', ')})`);
