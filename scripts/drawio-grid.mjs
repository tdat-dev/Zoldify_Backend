/**
 * Dựng sơ đồ trên lưới cho draw.io: hộp nhiều ngăn (class, bảng ERD), đường nối
 * đặt toạ độ tay chỉ gồm đoạn ngang/dọc, nhãn ở hai đầu, khung UML, và bộ kiểm
 * từ chối ghi file khi có đường xiên, đường cắt nhau hay đường đâm xuyên hộp.
 *
 * Dùng chung cho drawio-class.mjs và drawio-erd.mjs.
 */
import fs from 'node:fs';
import { esc } from './drawio-lib.mjs';

export const FONT = 'fontFamily=Helvetica;fontColor=#000000;';
export const ROW = 18, PAD = 8;

export function page(name) {
  const cells = [];
  let n = 0;
  return { name, cells, boxes: {}, segs: [], id: () => `c${++n}` };
}

/** UML class: optional stereotype line, bold name, attribute and/or operation compartments. */
export function cls(pg, key, { x, y, w = 230, name, stereo, attrs = null, ops = null, italic = false, extra = '' }) {
  const head = stereo ? 42 : 28;
  const comp = (list) => (list ? list.length * ROW + PAD : 0);
  const h = head + comp(attrs) + comp(ops);
  const title = stereo ? `«${esc(stereo)}»&lt;br&gt;&lt;b&gt;${esc(name)}&lt;/b&gt;` : `&lt;b&gt;${esc(name)}&lt;/b&gt;`;
  pg.cells.push(
    `<mxCell id="${key}" value="${title}" style="swimlane;html=1;fontStyle=${italic ? 2 : 0};align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;startSize=${head};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;whiteSpace=wrap;fontSize=12;fillColor=#FFFFFF;swimlaneFillColor=#FFFFFF;strokeColor=#000000;${FONT}${extra}" vertex="1" parent="1">` +
      `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  );
  let off = head;
  const rows = (list) => {
    off += PAD / 2;
    for (const r of list) {
      pg.cells.push(
        `<mxCell id="${pg.id()}" value="${esc(r)}" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=8;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=nowrap;fontSize=11;${FONT}" vertex="1" parent="${key}">` +
          `<mxGeometry y="${off}" width="${w}" height="${ROW}" as="geometry"/></mxCell>`,
      );
      off += ROW;
    }
    off += PAD / 2;
  };
  const divider = () => {
    pg.cells.push(
      `<mxCell id="${pg.id()}" value="" style="line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;strokeColor=#000000;" vertex="1" parent="${key}">` +
        `<mxGeometry y="${off}" width="${w}" height="1" as="geometry"/></mxCell>`,
    );
  };
  if (attrs) rows(attrs);
  if (ops) { if (attrs) divider(); rows(ops); }
  pg.boxes[key] = { x, y, w, h };
  return pg.boxes[key];
}

export function text(pg, value, x, y, align = 'left') {
  const w = value.length * 6.6 + 6;
  const ax = align === 'right' ? x - w : x;
  pg.cells.push(
    `<mxCell id="${pg.id()}" value="${esc(value)}" style="text;html=1;align=${align};verticalAlign=middle;fontSize=11;whiteSpace=nowrap;${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="${ax}" y="${y}" width="${w}" height="16" as="geometry"/></mxCell>`,
  );
}

export const STYLE = {
  assoc: 'endArrow=none;',
  comp: 'endArrow=none;startArrow=diamondThin;startFill=1;startSize=16;',
  use: 'endArrow=open;endFill=0;endSize=10;dashed=1;dashPattern=6 4;',
};

/**
 * Link two boxes along an explicit orthogonal path [[x,y], ...] whose first point lies
 * on box `a`'s border and last on box `b`'s. `ma` / `mb` are the end labels (multiplicity,
 * role) shown near each end; `label` sits on the middle of the line.
 */
export function link(pg, kind, a, b, pts, { ma, mb, label } = {}) {
  const A = pg.boxes[a], B = pg.boxes[b];
  const rel = (bx, [px, py]) => [(px - bx.x) / bx.w, (py - bx.y) / bx.h].map((v) => +v.toFixed(4));
  const [ex, ey] = rel(A, pts[0]);
  const [nx, ny] = rel(B, pts[pts.length - 1]);
  const inner = pts.slice(1, -1).map(([px, py]) => `<mxPoint x="${px}" y="${py}"/>`).join('');
  pg.cells.push(
    `<mxCell id="${pg.id()}" value="${label ? esc(label) : ''}" style="edgeStyle=none;html=1;rounded=0;strokeColor=#000000;fontSize=11;labelBackgroundColor=#FFFFFF;${FONT}${STYLE[kind]}` +
      `exitX=${ex};exitY=${ey};exitDx=0;exitDy=0;exitPerimeter=0;entryX=${nx};entryY=${ny};entryDx=0;entryDy=0;entryPerimeter=0;" edge="1" parent="1" source="${a}" target="${b}">` +
      `<mxGeometry relative="1" as="geometry">${inner ? `<Array as="points">${inner}</Array>` : ''}</mxGeometry></mxCell>`,
  );
  for (let i = 1; i < pts.length; i++) pg.segs.push({ a, b, p: pts[i - 1], q: pts[i] });
  endLabels(pg, pts[0], pts[1], ma, kind === 'comp'); // keep clear of the diamond
  endLabels(pg, pts[pts.length - 1], pts[pts.length - 2], mb);
}

/** Multiplicity above/right of the line end, role name below/left of it. */
function endLabels(pg, P, Q, labels, flip = false) {
  if (!labels) return;
  const [mult, role] = Array.isArray(labels) ? labels : [labels];
  const dx = Math.sign(Q[0] - P[0]), dy = Math.sign(Q[1] - P[1]);
  if (dy === 0) {
    const x = P[0] + dx * 6, align = dx < 0 ? 'right' : 'left';
    if (mult) text(pg, mult, x, flip ? P[1] + 2 : P[1] - 18, align);
    if (role) text(pg, role, x, P[1] + 2, align);
  } else {
    const y = dy > 0 ? P[1] + 4 : P[1] - 20;
    if (mult) text(pg, mult, flip ? P[0] - 6 : P[0] + 6, y, flip ? 'right' : 'left');
    if (role) text(pg, role, P[0] - 6, y, 'right');
  }
}

/** No two connector segments cross, and no segment runs through a box it does not end on. */
export function check(pg) {
  const problems = [];
  const H = (s) => s.p[1] === s.q[1];
  for (const s of pg.segs) if (s.p[0] !== s.q[0] && s.p[1] !== s.q[1]) problems.push(`diagonal ${s.a}-${s.b}`);
  for (let i = 0; i < pg.segs.length; i++)
    for (let j = i + 1; j < pg.segs.length; j++) {
      const s = pg.segs[i], t = pg.segs[j];
      if (H(s) === H(t)) continue;
      const [h, v] = H(s) ? [s, t] : [t, s];
      const hx = [Math.min(h.p[0], h.q[0]), Math.max(h.p[0], h.q[0])], vy = [Math.min(v.p[1], v.q[1]), Math.max(v.p[1], v.q[1])];
      const X = v.p[0], Y = h.p[1];
      if (X > hx[0] && X < hx[1] && Y > vy[0] && Y < vy[1]) problems.push(`cross ${s.a}-${s.b} x ${t.a}-${t.b}`);
    }
  for (const s of pg.segs)
    for (const [k, bx] of Object.entries(pg.boxes)) {
      if (k === s.a || k === s.b) continue;
      const x1 = Math.min(s.p[0], s.q[0]), x2 = Math.max(s.p[0], s.q[0]), y1 = Math.min(s.p[1], s.q[1]), y2 = Math.max(s.p[1], s.q[1]);
      if (x2 > bx.x && x1 < bx.x + bx.w && y2 > bx.y && y1 < bx.y + bx.h) problems.push(`${s.a}-${s.b} runs through ${k}`);
    }
  for (const [k, bx] of Object.entries(pg.boxes))
    for (const [k2, b2] of Object.entries(pg.boxes))
      if (k < k2 && bx.x < b2.x + b2.w && b2.x < bx.x + bx.w && bx.y < b2.y + b2.h && b2.y < bx.y + bx.h) problems.push(`overlap ${k} ${k2}`);
  if (problems.length) throw new Error(`${pg.name}:\n  ${problems.join('\n  ')}`);
}

export function frame(pg, title) {
  const xs = [...Object.values(pg.boxes).map((b) => b.x + b.w), ...pg.segs.flatMap((s) => [s.p[0], s.q[0]])];
  const ys = [...Object.values(pg.boxes).map((b) => b.y + b.h), ...pg.segs.flatMap((s) => [s.p[1], s.q[1]])];
  const r = Math.max(...xs) + 30;
  const btm = Math.max(...ys) + 30;
  const tw = title.length * 7 + 30;
  pg.cells.unshift(
    `<mxCell id="frame" value="${esc(title)}" style="shape=umlFrame;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontSize=12;fontStyle=1;verticalAlign=top;align=left;spacingLeft=6;spacingTop=-1;width=${tw};height=24;${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="10" y="20" width="${r - 10}" height="${btm - 20}" as="geometry"/></mxCell>`,
  );
  pg.size = { w: r + 40, h: btm + 40 };
}

/** Ghi nhiều trang vào một file .drawio. */
export function writePages(out, pages) {
  const body = pages
    .map(
      (p, i) =>
        `  <diagram id="cd${i + 1}" name="${esc(p.name)}">\n    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.ceil(p.size.w)}" pageHeight="${Math.ceil(p.size.h)}" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
        p.cells.map((c) => '        ' + c).join('\n') +
        `\n      </root>\n    </mxGraphModel>\n  </diagram>`,
    )
    .join('\n');
  fs.writeFileSync(out, `<mxfile host="app.diagrams.net" type="device">\n${body}\n</mxfile>\n`);
  console.log(`${out}: ${pages.map((p) => p.name).join(', ')}`);
}
