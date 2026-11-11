#!/usr/bin/env node
/**
 * Sinh 12-slide-diagrams.drawio: bản rút gọn của các sơ đồ để chiếu trên slide.
 *
 * Sơ đồ đầy đủ trong báo cáo có chữ khoảng 5pt khi đặt lên slide 16:9, hội đồng
 * không đọc được. Mỗi trang ở đây vẽ cho khung slide: rộng 1265 đơn vị, một đơn
 * vị bằng 0,72pt trên slide, nên chữ 18px thành khoảng 13pt. Số liệu và quan hệ
 * lấy từ các sơ đồ gốc, bản đầy đủ vẫn là 05, 08, Sequence-Diagrams. Use case
 * không vẽ lại: slide xuất thẳng các trang của 05-use-case-diagram.
 *
 *   node scripts/drawio-slides.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSheet, edge, edgeAt, esc, vertex } from './drawio-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', '12-slide-diagrams.drawio');

const FONT = 'fontFamily=Helvetica;fontColor=#000000;';
const LINE = 'strokeColor=#000000;strokeWidth=1.5;';
const ST = {
  assoc: `edgeStyle=none;html=1;rounded=0;endArrow=none;${LINE}`,
  dep: `edgeStyle=none;html=1;rounded=0;dashed=1;dashPattern=6 4;endArrow=open;endFill=0;endSize=12;strokeColor=#000000;strokeWidth=1.2;fontSize=16;labelBackgroundColor=#FFFFFF;${FONT}`,
  flow: `edgeStyle=none;html=1;rounded=0;endArrow=block;endFill=1;endSize=9;${LINE}`,
  action: (fs_ = 19) => `rounded=1;arcSize=18;whiteSpace=wrap;html=1;fontSize=${fs_};fillColor=#FFFFFF;${LINE}${FONT}`,
  rhombus: `rhombus;whiteSpace=wrap;html=1;fontSize=18;fillColor=#FFFFFF;${LINE}${FONT}`,
  dotStart: 'ellipse;html=1;fillColor=#000000;strokeColor=#000000;',
  dotEnd: 'ellipse;html=1;shape=endState;fillColor=#000000;strokeColor=#000000;strokeWidth=1.5;',
  text: (fs_ = 17, extra = '') => `text;html=1;align=center;verticalAlign=middle;whiteSpace=nowrap;fontSize=${fs_};${FONT}${extra}`,
  box: (fs_ = 19, bold = 1) => `rounded=0;whiteSpace=wrap;html=1;fontSize=${fs_};fontStyle=${bold};fillColor=#FFFFFF;${LINE}${FONT}`,
  group: `rounded=0;whiteSpace=wrap;html=1;fontSize=17;fontStyle=1;fillColor=none;${LINE}verticalAlign=top;align=left;spacingLeft=10;spacingTop=2;${FONT}`,
  swim: (head, fs_) => `swimlane;html=1;align=center;verticalAlign=middle;startSize=${head};horizontal=1;collapsible=0;whiteSpace=wrap;fontSize=${fs_};fontStyle=1;fillColor=#FFFFFF;swimlaneFillColor=#FFFFFF;${LINE}${FONT}`,
  row: (fs_) => `text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=10;whiteSpace=nowrap;overflow=hidden;fontSize=${fs_};${FONT}`,
};

const NAVY = '#002060', TINT = '#EAF0FA', AMBER = '#C97A00', AMBER_T = '#FDF1DC';
const GREEN = '#1E7B45';

/** Ô nền màu, chữ căn giữa. */
const tileStyle = (fill, line = 'none') =>
  `rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${line};${FONT}`;

/** Chữ tự do, không khung. */
function words(s, value, x, y, w, h, size, { bold = false, color = '#000000', align = 'center', italic = false } = {}) {
  const st = `text;html=1;whiteSpace=wrap;verticalAlign=middle;align=${align};fontSize=${size};fontStyle=${(bold ? 1 : 0) + (italic ? 2 : 0)};fontFamily=Helvetica;fontColor=${color};`;
  return vertex(s, { value, style: st, x, y, w, h });
}

/** Thẻ: tiêu đề đậm và một dòng giải thích, tất cả nằm trong một ô nền. */
function card(s, x, y, w, h, head, sub, { fill = TINT, color = NAVY, headSize = 30, subSize = 23, align = 'center', split = 0.42 } = {}) {
  vertex(s, { value: '', style: tileStyle(fill), x, y, w, h });
  const pad = align === 'left' ? 18 : 10;
  words(s, head, x + pad, y + 8, w - 2 * pad, h * split, headSize, { bold: true, color, align });
  words(s, sub, x + pad, y + h * split, w - 2 * pad, h * (1 - split) - 8, subSize, { align });
}

/** Bảng: hàng đầu là tiêu đề, `hl` là các hàng tô màu cam nhạt. */
function grid(s, x, y, widths, rows, { rowH = 62, size = 22, head = NAVY, hl = [] } = {}) {
  rows.forEach((row, r) => {
    let cx = x;
    row.forEach((val, i) => {
      const fill = r === 0 ? head : hl.includes(r) ? AMBER_T : r % 2 ? TINT : '#FFFFFF';
      const st = `rounded=0;whiteSpace=wrap;html=1;align=left;spacingLeft=14;verticalAlign=middle;fontSize=${size};fontStyle=${r === 0 ? 1 : 0};fillColor=${fill};strokeColor=#FFFFFF;strokeWidth=2;fontFamily=Helvetica;fontColor=${r === 0 ? '#FFFFFF' : '#000000'};`;
      vertex(s, { value: val, style: st, x: cx, y: y + r * rowH, w: widths[i], h: rowH });
      cx += widths[i];
    });
  });
}

function sheet(name, w, h) {
  const s = createSheet(name);
  s.w = w;
  s.h = h;
  s.at = {};
  return s;
}

/** Vẽ một hình và nhớ toạ độ để đường nối ghim đúng điểm. */
function node(s, key, value, style, x, y, w, h) {
  vertex(s, { id: key, value, style, x, y, w, h });
  s.at[key] = { x, y, w, h };
  return key;
}

const label = (s, value, cx, cy, fs_ = 17, w = 90, extra = '') =>
  vertex(s, { value, style: ST.text(fs_, extra), x: cx - w / 2, y: cy - 14, w, h: 28 });

/** Nối hai hình tại hai điểm tuyệt đối trên viền của chúng. */
function wire(s, a, b, p1, p2, style = ST.assoc, { value = '', points } = {}) {
  const rel = (k, [x, y]) => {
    const g = s.at[k];
    return [(x - g.x) / g.w, (y - g.y) / g.h];
  };
  const pin = (p, [x, y]) => `${p}X=${x.toFixed(4)};${p}Y=${y.toFixed(4)};${p}Dx=0;${p}Dy=0;${p}Perimeter=0;`;
  return edge(s, { source: a, target: b, value, points, style: style + pin('exit', rel(a, p1)) + pin('entry', rel(b, p2)) });
}

const mid = (s, k) => {
  const g = s.at[k];
  return { l: [g.x, g.y + g.h / 2], r: [g.x + g.w, g.y + g.h / 2], t: [g.x + g.w / 2, g.y], b: [g.x + g.w / 2, g.y + g.h] };
};

// ------------------------------------------------------------- activity
function activity() {
  const s = sheet('Activity Checkout', 1265, 500);
  const Y1 = 75, Y2 = 245, Y3 = 415;
  const act = (k, v, cx, cy, w = 170, h = 80) => node(s, k, v, ST.action(), cx - w / 2, cy - h / 2, w, h);
  const dec = (k, v, cx, cy, w = 180, h = 110) => node(s, k, v, ST.rhombus, cx - w / 2, cy - h / 2, w, h);
  const to = (a, b, p1, p2, value = '') => wire(s, a, b, p1, p2, ST.flow, { value });
  node(s, 'start', '', ST.dotStart, 5, Y1 - 16, 32, 32);
  act('open', 'Open checkout', 150, Y1, 160);
  dec('signed', 'Signed in?', 350, Y1, 170);
  act('check', 'Check price and stock', 545, Y1, 160);
  act('create', 'Create order, reduce stock, clear cart', 755, Y1, 200, 96);
  dec('pay', 'Payment?', 985, Y1, 170);
  act('link', 'Create link', 1185, Y1, 150);
  act('qr', 'Buyer pays QR', 1185, Y2, 150);
  act('hook', 'Verify webhook', 1185, Y3, 150);
  act('wallet', 'Debit wallet', 985, Y2, 170);
  act('hold', 'Hold in escrow', 985, Y3, 170);
  act('seller', 'Seller confirms', 755, Y2, 190);
  act('ok', 'Order confirmed', 755, Y3, 190);
  act('deny', '401: ask to sign in', 350, Y2, 190);
  node(s, 'end1', '', ST.dotEnd, 334, Y3 - 16, 32, 32);
  node(s, 'end2', '', ST.dotEnd, 560, Y3 - 16, 32, 32);
  const m = (k) => mid(s, k);
  to('start', 'open', m('start').r, m('open').l);
  to('open', 'signed', m('open').r, m('signed').l);
  to('signed', 'check', m('signed').r, m('check').l);
  to('check', 'create', m('check').r, m('create').l);
  to('create', 'pay', m('create').r, m('pay').l);
  to('pay', 'link', m('pay').r, m('link').l);
  to('link', 'qr', m('link').b, m('qr').t);
  to('qr', 'hook', m('qr').b, m('hook').t);
  to('hook', 'hold', m('hook').l, m('hold').r);
  to('pay', 'wallet', m('pay').b, m('wallet').t);
  to('wallet', 'hold', m('wallet').b, m('hold').t);
  to('hold', 'ok', m('hold').l, m('ok').r);
  to('pay', 'seller', [942, Y1 + 28], [800, Y2 - 40]);
  to('seller', 'ok', m('seller').b, m('ok').t);
  to('ok', 'end2', m('ok').l, m('end2').r);
  to('signed', 'deny', m('signed').b, m('deny').t);
  to('deny', 'end1', m('deny').b, m('end1').t);
  label(s, 'yes', 448, Y1 - 18, 17, 50);
  label(s, 'no', 378, 158, 17, 40);
  label(s, 'PayOS', 1068, Y1 - 36, 17, 70);
  label(s, 'wallet', 1020, 158, 17, 70);
  label(s, 'COD', 875, 165, 17, 60);
  return s;
}

// ------------------------------------------------------------- class và ERD
function table(s, key, title, rows, x, y, w, fs_ = 18) {
  const HEAD = 38, ROW = 25, PAD = 8;
  const h = HEAD + rows.length * ROW + PAD;
  node(s, key, title, ST.swim(HEAD, fs_ + 1), x, y, w, h);
  rows.forEach((r, i) => {
    vertex(s, { value: r, style: ST.row(fs_), x: 0, y: HEAD + PAD / 2 + i * ROW, w, h: ROW, parent: key });
  });
  return s.at[key];
}

const COMP = `edgeStyle=none;html=1;rounded=0;startArrow=diamondThin;startFill=1;startSize=18;endArrow=none;${LINE}`;

function classCore() {
  const s = sheet('Class Core', 1265, 530);
  const C = [10, 335, 660, 985], W = 260;
  const address = table(s, 'Address', 'Address', ['street: String', 'ghn_district_id: Int'], C[0], 10, W);
  const user = table(s, 'User', 'User', ['email: String {unique}', 'role: UserRole', 'is_locked: Boolean'], C[1], 10, W);
  const product = table(s, 'Product', 'Product', ['price: Decimal', 'stock: Integer', 'status: ProductStatus'], C[2], 10, W);
  const category = table(s, 'Category', 'Category', ['name: String {unique}', 'slug: String'], C[3], 10, W);
  const shop = table(s, 'Shop', 'Shop', ['name: String', 'status: ShopStatus'], C[0], 215, W);
  const order = table(s, 'Order', 'Order', ['order_code: String', 'final_amount: Decimal', 'status: OrderStatus', 'is_paid: Boolean'], C[1], 215, W);
  const item = table(s, 'OrderItem', 'OrderItem', ['price: Decimal', 'quantity: Integer'], C[2], 215, W);
  const review = table(s, 'Review', 'Review', ['rating: Integer', 'comment: String'], C[3], 215, W);
  const ship = table(s, 'OrderShipment', 'OrderShipment', ['tracking_code: String', 'status: ShipmentStatus'], C[1], 425, W);
  const r = (b) => b.x + b.w, cx = (b) => b.x + b.w / 2, bt = (b) => b.y + b.h;
  wire(s, 'User', 'Address', [user.x, 65], [r(address), 65], COMP);
  label(s, '0..*', r(address) + 20, 50, 17, 44);
  wire(s, 'User', 'Shop', [user.x, 110], [r(shop), 262], COMP, { points: [[316, 110], [316, 262]] });
  label(s, '0..1', r(shop) + 21, 247, 17, 42);
  wire(s, 'User', 'Product', [r(user), 65], [product.x, 65]);
  label(s, 'seller', r(user) + 30, 84, 17, 54);
  label(s, '0..*', product.x - 24, 50, 17, 44);
  wire(s, 'Product', 'Category', [r(product), 65], [category.x, 65]);
  label(s, '0..*', r(product) + 22, 84, 17, 44);
  label(s, '0..1', category.x - 24, 50, 17, 44);
  wire(s, 'User', 'Order', [cx(user), bt(user)], [cx(order), order.y]);
  label(s, 'buyer', cx(user) + 34, bt(user) + 16, 17, 54);
  label(s, '0..*', cx(order) + 26, order.y - 15, 17, 44);
  wire(s, 'Order', 'OrderItem', [r(order), 262], [item.x, 262], COMP);
  label(s, '1..*', item.x - 24, 247, 17, 44);
  wire(s, 'OrderItem', 'Product', [cx(item), item.y], [cx(product), bt(product)]);
  label(s, '0..*', cx(item) + 26, item.y - 15, 17, 44);
  label(s, '0..1', cx(product) + 26, bt(product) + 15, 17, 44);
  wire(s, 'Product', 'Review', [r(product), 115], [review.x, 262], ST.assoc, { points: [[950, 115], [950, 262]] });
  label(s, '0..*', review.x - 18, 247, 17, 36);
  wire(s, 'Order', 'OrderShipment', [cx(order), bt(order)], [cx(ship), ship.y], COMP);
  label(s, '0..*', cx(ship) + 26, ship.y - 15, 17, 44);
  return s;
}

function classMoney() {
  const s = sheet('Class Money', 1265, 440);
  const C = [10, 335, 660, 985], W = 260;
  const pay = table(s, 'Payment', 'Payment', ['amount: Decimal', 'type: PaymentType', 'status: PaymentStatus'], C[0], 10, W);
  const order = table(s, 'Order', 'Order', ['final_amount: Decimal', 'status: OrderStatus', 'is_paid: Boolean'], C[1], 10, W);
  const escrow = table(s, 'Escrow', 'Escrow', ['amount: Decimal', 'status: EscrowStatus', 'released_at: DateTime'], C[2], 10, W);
  const wallet = table(s, 'Wallet', 'Wallet', ['balance: Decimal'], C[3], 10, W);
  const lt = table(s, 'LedgerTransaction', 'LedgerTransaction', ['type: LedgerTxType', 'idempotency_key {unique}'], C[0], 290, W);
  const le = table(s, 'LedgerEntry', 'LedgerEntry', ['amount: BigInt', 'balance_after: BigInt'], C[1], 290, W);
  const la = table(s, 'LedgerAccount', 'LedgerAccount', ['purpose: LedgerPurpose', 'balance: BigInt'], C[2], 290, W);
  const wt = table(s, 'WalletTransaction', 'WalletTransaction', ['type: TransactionType', 'amount: Decimal'], C[3], 290, W);
  const r = (b) => b.x + b.w, cx = (b) => b.x + b.w / 2;
  wire(s, 'Payment', 'Order', [r(pay), 65], [order.x, 65]);
  label(s, '0..*', r(pay) + 22, 84, 17, 44);
  label(s, '0..1', order.x - 24, 50, 17, 44);
  wire(s, 'Order', 'Escrow', [r(order), 65], [escrow.x, 65]);
  label(s, '1', r(order) + 12, 50, 17, 20);
  label(s, '0..*', escrow.x - 24, 50, 17, 44);
  wire(s, 'LedgerTransaction', 'LedgerEntry', [r(lt), 345], [le.x, 345], COMP);
  label(s, '2..*', le.x - 24, 330, 17, 44);
  wire(s, 'LedgerEntry', 'LedgerAccount', [r(le), 345], [la.x, 345]);
  label(s, '0..*', r(le) + 22, 330, 17, 44);
  label(s, '1', la.x - 12, 330, 17, 20);
  wire(s, 'Wallet', 'WalletTransaction', [cx(wallet), wallet.y + wallet.h], [cx(wt), wt.y], COMP);
  label(s, '0..*', cx(wt) + 26, wt.y - 15, 17, 44);
  return s;
}

function erd() {
  const s = sheet('ERD Money', 1265, 545);
  const C = [10, 435, 860], W = 395;
  const ER = (a, b) => `edgeStyle=none;html=1;rounded=0;startArrow=${a};startFill=0;startSize=16;endArrow=${b};endFill=0;endSize=16;${LINE}`;
  const payments = table(s, 'payments', 'payments', ['id PK', 'order_id FK', 'amount, status'], C[0], 10, W);
  const orders = table(s, 'orders', 'orders', ['id PK', 'order_code UQ', 'final_amount, status'], C[1], 10, W);
  const escrows = table(s, 'escrows', 'escrows', ['id PK', 'order_id FK, seller_id FK', 'amount, status'], C[2], 10, W);
  const lt = table(s, 'lt', 'ledger_transactions', ['id PK', 'idempotency_key UQ', 'type'], C[0], 245, W);
  const le = table(s, 'le', 'ledger_entries', ['id PK', 'transaction_id FK, account_id FK', 'amount BIGINT'], C[1], 245, W);
  const la = table(s, 'la', 'ledger_accounts', ['id PK', 'owner_type, purpose', 'balance BIGINT'], C[2], 245, W);
  const r = (b) => b.x + b.w;
  wire(s, 'payments', 'orders', [r(payments), 75], [orders.x, 75], ER('ERmany', 'ERone'));
  wire(s, 'orders', 'escrows', [r(orders), 75], [escrows.x, 75], ER('ERone', 'ERmany'));
  wire(s, 'lt', 'le', [r(lt), 310], [le.x, 310], ER('ERone', 'ERmany'));
  wire(s, 'le', 'la', [r(le), 310], [la.x, 310], ER('ERmany', 'ERone'));
  // 27 bảng chia 4 nhóm, trang này vẽ nhóm tiền.
  [['8', 'Identity and catalogue'], ['3', 'Ordering'], ['8', 'Money'], ['8', 'Messaging and ops']].forEach(([n, lab], i) => {
    const x = 10 + i * 312;
    vertex(s, { value: '', style: tileStyle(i === 2 ? AMBER_T : TINT), x, y: 440, w: 300, h: 100 });
    words(s, n, x + 10, 440, 70, 100, 40, { bold: true, color: NAVY });
    words(s, lab, x + 82, 440, 210, 100, 21, { align: 'left' });
  });
  return s;
}

// ------------------------------------------------------------- sequence
function sequence(name, lifes, msgs, step) {
  const s = sheet(name, 1265, 500);
  const LIFE = 'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=0;collapsible=0;recursiveResize=0;outlineConnect=0;size=46;fontSize=21;fontStyle=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=1.2;' + FONT;
  const xs = {};
  for (const [n, x] of lifes) {
    xs[n] = x;
    vertex(s, { value: n, style: LIFE, x: x - 105, y: 5, w: 210, h: 490 });
  }
  const MSG = `edgeStyle=none;html=1;rounded=0;endArrow=block;endFill=1;endSize=9;strokeColor=#000000;strokeWidth=1.5;fontSize=20;verticalAlign=bottom;${FONT}`;
  const BACK = MSG.replace('endArrow=block;endFill=1', 'dashed=1;endArrow=open;endFill=0');
  msgs.forEach(([a, b, text, back], i) => {
    const y = 85 + i * step;
    if (a === b) {
      vertex(s, { value: text, style: ST.box(20, 1), x: xs[a] - 160, y: y - 22, w: 320, h: 44 });
      return;
    }
    edgeAt(s, { x1: xs[a], y1: y, x2: xs[b], y2: y, value: text, style: back ? BACK : MSG });
  });
  return s;
}

// ------------------------------------------------------------- triển khai
function deployment() {
  const s = sheet('Deployment', 1265, 540);
  const b = (k, v, x, y, w, h, bold = 1) => node(s, k, v, ST.box(19, bold), x, y, w, h);
  b('web0', 'Web browser', 5, 35, 165, 90);
  b('app0', 'Android app', 5, 165, 165, 90);
  b('cf', 'Cloudflare\nDNS, proxy', 210, 35, 170, 220);
  b('r2', 'Cloudflare R2\nimages, backups', 210, 315, 170, 120);
  node(s, 'vps', 'One VPS, Docker Compose', ST.group, 420, 5, 665, 530);
  b('nginx', 'nginx (TLS)', 440, 43, 625, 58);
  b('web', 'web', 440, 127, 150, 68);
  b('admin', 'admin', 600, 127, 150, 68);
  b('caddy', 'Caddy (load balancer)', 760, 127, 305, 68);
  b('migrate', 'migrate', 440, 221, 150, 68);
  b('api', 'api x 3', 600, 221, 285, 68);
  b('worker', 'worker', 895, 221, 170, 68);
  b('mysql', 'MySQL 8', 440, 315, 205, 68);
  b('redis', 'Redis', 655, 315, 200, 68);
  b('queue', 'Redis queue', 865, 315, 200, 68);
  b('offsite', 'offsite', 440, 409, 205, 68);
  b('backup', 'backup', 655, 409, 200, 68);
  b('gha', 'GitHub Actions deploys over SSH', 440, 487, 625, 38);
  ['PayOS\npayment', 'GHN\nsandbox', 'Firebase\nGoogle, FCM', 'SMTP\nOTP email'].forEach((v, i) => {
    b(`x${i}`, v, 1115, 15 + i * 130, 148, 100);
  });
  const to = (a, c, p1, p2, st = ST.flow) => wire(s, a, c, p1, p2, st);
  to('web0', 'cf', [170, 80], [210, 80]);
  to('app0', 'cf', [170, 210], [210, 210]);
  to('cf', 'nginx', [380, 72], [440, 72]);
  to('nginx', 'web', [515, 101], [515, 127]);
  to('nginx', 'admin', [675, 101], [675, 127]);
  to('nginx', 'caddy', [912, 101], [912, 127]);
  to('caddy', 'api', [800, 195], [800, 221]);
  to('migrate', 'mysql', [515, 289], [515, 315]);
  to('api', 'mysql', [620, 289], [620, 315]);
  to('api', 'redis', [750, 289], [750, 315]);
  to('worker', 'queue', [980, 289], [980, 315]);
  to('mysql', 'backup', [620, 383], [690, 409]);
  to('backup', 'offsite', [655, 443], [645, 443]);
  to('offsite', 'r2', [440, 443], [380, 400], ST.flow + 'dashed=1;');
  to('vps', 'x1', [1085, 161], [1115, 161]);
  return s;
}

// ------------------------------------------------------------- dòng tiền và tranh chấp
function moneyFlow() {
  const s = sheet('Escrow Flow', 1265, 550);
  const c = (fill, line) => `rounded=1;arcSize=10;whiteSpace=wrap;html=1;fontSize=23;fontStyle=1;fillColor=${fill};strokeColor=${line};strokeWidth=1.5;${FONT}`;
  const b = (k, v, x, y, w, h, fill = '#EAF0FA', line = '#002060') => node(s, k, v, c(fill, line), x, y, w, h);
  b('buyer', 'Buyer\nPayOS or wallet', 20, 135, 200, 125);
  b('gate', 'Gateway clearing', 285, 135, 230, 125);
  b('hold', 'Escrow hold\nper seller', 580, 115, 250, 165, '#FDF1DC', '#C97A00');
  b('seller', 'Seller wallet\ngoods - fee + shipping', 945, 10, 310, 120, '#E3F4E9', '#1E7B45');
  b('rev', 'Platform revenue\n5% of goods', 945, 150, 310, 110);
  b('refund', 'Buyer wallet\nfull refund', 945, 280, 310, 120, '#FBE6E4', '#B42318');
  const arrow = (color) => `edgeStyle=none;html=1;rounded=0;endArrow=block;endFill=1;endSize=10;strokeColor=${color};strokeWidth=2.5;`;
  wire(s, 'buyer', 'gate', [220, 197], [285, 197], arrow('#2F5597'));
  wire(s, 'gate', 'hold', [515, 197], [580, 197], arrow('#2F5597'));
  wire(s, 'hold', 'seller', [830, 150], [945, 70], arrow('#1E7B45'));
  wire(s, 'hold', 'rev', [830, 197], [945, 205], arrow('#2F5597'));
  wire(s, 'hold', 'refund', [830, 245], [945, 340], arrow('#B42318'));
  vertex(s, { value: 'Receipt, or 3 days after delivery', style: ST.text(21, 'fontStyle=1;fontColor=#1E7B45;'), x: 560, y: 55, w: 380, h: 34 });
  vertex(s, { value: 'Order cancelled', style: ST.text(21, 'fontStyle=1;fontColor=#B42318;'), x: 580, y: 300, w: 250, h: 34 });
  [['Σ = 0', 'Every posting balances'], ['1 key', 'Posted only once'], ['Check', 'Balances recomputed']].forEach(([k, d_], i) => {
    const x = 20 + i * 415;
    vertex(s, { value: '', style: tileStyle('#F4F6FA'), x, y: 440, w: 395, h: 105 });
    words(s, k, x + 15, 440, 130, 105, 31, { bold: true, color: NAVY, align: 'left' });
    words(s, d_, x + 150, 440, 235, 105, 21, { align: 'left' });
  });
  return s;
}

function race() {
  const s = sheet('Two Buyers', 1265, 530);
  const c = (fill, line) => `rounded=1;arcSize=12;whiteSpace=wrap;html=1;fontSize=21;fillColor=${fill};strokeColor=${line};strokeWidth=1.5;${FONT}`;
  const b = (k, v, x, y, fill = '#EAF0FA', line = '#002060') => node(s, k, v, c(fill, line), x, y, 340, 80);
  vertex(s, { value: 'Buyer A', style: ST.text(25, 'fontStyle=1;'), x: 40, y: 0, w: 340, h: 36 });
  vertex(s, { value: 'Buyer B', style: ST.text(25, 'fontStyle=1;'), x: 415, y: 0, w: 340, h: 36 });
  edgeAt(s, { x1: 15, y1: 45, x2: 15, y2: 525, style: ST.flow });
  b('a1', 'Locks the product row', 40, 45);
  b('b1', 'Waits for the lock', 415, 45, '#FDF1DC', '#C97A00');
  b('a2', 'Stock 1 → 0, order created', 40, 140);
  b('a3', 'COMMIT, lock released', 40, 235, '#E3F4E9', '#1E7B45');
  b('b2', 'Reads stock again: 0', 415, 330);
  b('b3', '400: out of stock', 415, 425, '#FBE6E4', '#B42318');
  wire(s, 'a3', 'b2', [380, 275], [415, 370], ST.flow);
  [['SELECT FOR UPDATE', 'row lock'], ['stock >= n', 'conditional UPDATE'], ['CHECK stock >= 0', 'in MySQL'], ['20 buyers', 'check:race, real MySQL']].forEach(([h, d_], i) => {
    const last = i === 3;
    card(s, 805, 5 + i * 130, 455, 115, h, d_, { fill: last ? AMBER_T : TINT, color: last ? AMBER : NAVY, headSize: 25, subSize: 21, align: 'left', split: 0.5 });
  });
  return s;
}

function ledgerPosting() {
  const s = sheet('Ledger Posting', 1265, 545);
  words(s, 'Goods 380,000 + shipping 82,500 = 462,500 VND. Fee: 5% of goods.', 10, 0, 1245, 56, 28, { bold: true, color: NAVY, align: 'left' });
  grid(s, 10, 80, [370, 230], [
    ['1. Buyer pays', 'Amount'],
    ['Gateway clearing', '-462,500'],
    ['Escrow hold', '+462,500'],
    ['Sum', '0'],
  ], { hl: [3] });
  grid(s, 655, 80, [370, 230], [
    ['2. Buyer confirms receipt', 'Amount'],
    ['Escrow hold', '-462,500'],
    ['Seller wallet', '+443,500'],
    ['Platform revenue', '+19,000'],
    ['Sum', '0'],
  ], { head: GREEN, hl: [4] });
  words(s, 'Unique key per posting. Accounts locked in id order.', 10, 435, 1245, 50, 25);
  words(s, 'Amounts from a staging test order, 05/11/2026', 10, 488, 1245, 40, 17, { italic: true, color: '#5B6472' });
  return s;
}

function operations() {
  const s = sheet('Operations', 1265, 530);
  [['API x 3', 'Stateless, Redis shared'], ['Worker', 'Scheduled jobs run once'], ['Chat and push', 'Socket.IO, FCM'],
    ['GHN', 'Quote, waybill per seller'], ['Images', 'WebP on Cloudflare R2'], ['Backups', 'Daily, copied off-site']].forEach(([h, d_], i) => {
    card(s, 10 + (i % 3) * 418, 10 + Math.floor(i / 3) * 265, 400, 245, h, d_, { headSize: 33, subSize: 25, split: 0.48 });
  });
  return s;
}

const pages = [
  deployment(),
  // Slide use case dùng thẳng trang của 05-use-case-diagram (bản nhóm vẽ), không vẽ lại ở đây.
  activity(),
  classCore(),
  classMoney(),
  sequence('Sequence Create Link', [['Client', 115], ['Zoldify API', 470], ['MySQL', 820], ['PayOS', 1150]], [
    ['Client', 'Zoldify API', 'POST /payos/create-link'],
    ['Zoldify API', 'MySQL', 'Check owner and unpaid'],
    ['Zoldify API', 'PayOS', 'Create payment link'],
    ['PayOS', 'Zoldify API', 'checkoutUrl, QR', true],
    ['Zoldify API', 'MySQL', 'Save PENDING payment'],
    ['Zoldify API', 'MySQL', 'Create escrow rows'],
    ['Zoldify API', 'Client', '201: checkoutUrl, QR', true],
  ], 62),
  sequence('Sequence Webhook', [['PayOS', 150], ['Zoldify API', 610], ['MySQL', 1070]], [
    ['PayOS', 'Zoldify API', 'POST webhook + signature'],
    ['Zoldify API', 'Zoldify API', 'Verify signature first'],
    ['Zoldify API', 'MySQL', 'BEGIN, lock the order'],
    ['Zoldify API', 'MySQL', 'Already paid? Stop'],
    ['Zoldify API', 'MySQL', 'Post ledger entries'],
    ['Zoldify API', 'MySQL', 'Update payment, order, escrow'],
    ['Zoldify API', 'MySQL', 'COMMIT'],
    ['Zoldify API', 'PayOS', '200 OK', true],
  ], 55),
  erd(),
  moneyFlow(),
  race(),
  ledgerPosting(),
  operations(),
];

const body = pages
  .map(
    (p, i) =>
      `  <diagram id="s${i + 1}" name="${esc(p.name)}">\n    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${p.w}" pageHeight="${p.h}" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
      p.cells.map((c) => `        ${c}`).join('\n') +
      `\n      </root>\n    </mxGraphModel>\n  </diagram>`,
  )
  .join('\n');
fs.writeFileSync(OUT, `<mxfile host="Electron" pages="${pages.length}">\n${body}\n</mxfile>\n`);
console.log(`${path.relative(ROOT, OUT)}: ${pages.map((p) => p.name).join(', ')}`);
