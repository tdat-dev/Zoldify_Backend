#!/usr/bin/env node
/**
 * Sinh 08-class-diagram.drawio theo ký pháp UML 2.5 (mẫu uml-diagrams.org):
 *
 *   1. Domain Model   : 21 entity thật trong src/**\/entities, thuộc tính `tên: Kiểu`,
 *                       {id} / {unique} / [0..1], multiplicity ở hai đầu, hợp thành
 *                       (thoi đặc) khi con không sống được thiếu cha.
 *   2. Enumerations   : các enum mà cột entity dùng.
 *   3. Money Services : tầng service giữ luật tiền, có phương thức và phụ thuộc «use».
 *
 * Mọi đường nối là đoạn ngang/dọc đặt toạ độ tay; script tự kiểm không có đường
 * nào cắt nhau hay đi xuyên qua lớp khác trước khi ghi file.
 *
 *   node scripts/drawio-class.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './drawio-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', '08-class-diagram.drawio');

const FONT = 'fontFamily=Helvetica;fontColor=#000000;';
const W = 230, ROW = 18, PAD = 8;
const C = [40, 330, 620, 910, 1200, 1490]; // column x, 60px gutters for routing

function page(name) {
  const cells = [];
  let n = 0;
  return { name, cells, boxes: {}, segs: [], id: () => `c${++n}` };
}

/** UML class: optional stereotype line, bold name, attribute and/or operation compartments. */
function cls(pg, key, { x, y, w = W, name, stereo, attrs = null, ops = null, italic = false }) {
  const head = stereo ? 42 : 28;
  const comp = (list) => (list ? list.length * ROW + PAD : 0);
  const h = head + comp(attrs) + comp(ops);
  const title = stereo ? `«${esc(stereo)}»&lt;br&gt;&lt;b&gt;${esc(name)}&lt;/b&gt;` : `&lt;b&gt;${esc(name)}&lt;/b&gt;`;
  pg.cells.push(
    `<mxCell id="${key}" value="${title}" style="swimlane;html=1;fontStyle=${italic ? 2 : 0};align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;startSize=${head};horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;whiteSpace=wrap;fontSize=12;fillColor=#FFFFFF;swimlaneFillColor=#FFFFFF;strokeColor=#000000;${FONT}" vertex="1" parent="1">` +
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

function text(pg, value, x, y, align = 'left') {
  const w = value.length * 6.6 + 6;
  const ax = align === 'right' ? x - w : x;
  pg.cells.push(
    `<mxCell id="${pg.id()}" value="${esc(value)}" style="text;html=1;align=${align};verticalAlign=middle;fontSize=11;whiteSpace=nowrap;${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="${ax}" y="${y}" width="${w}" height="16" as="geometry"/></mxCell>`,
  );
}

const STYLE = {
  assoc: 'endArrow=none;',
  comp: 'endArrow=none;startArrow=diamondThin;startFill=1;startSize=16;',
  use: 'endArrow=open;endFill=0;endSize=10;dashed=1;dashPattern=6 4;',
};

/**
 * Link two boxes along an explicit orthogonal path [[x,y], ...] whose first point lies
 * on box `a`'s border and last on box `b`'s. `ma` / `mb` are the end labels (multiplicity,
 * role) shown near each end; `label` sits on the middle of the line.
 */
function link(pg, kind, a, b, pts, { ma, mb, label } = {}) {
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
function check(pg) {
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

function frame(pg, title) {
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

// =============================================================== page 1: domain model
const dm = page('Domain Model');
cls(dm, 'User', { x: C[1], y: 80, name: 'User', attrs: ['id: Integer {id}', 'full_name: String', 'email: String {unique}', 'password: String', 'phone_number: String [0..1]', 'role: UserRole', 'email_verified: Boolean', 'is_locked: Boolean', 'token_version: Integer'] });
cls(dm, 'Address', { x: C[0], y: 80, name: 'Address', attrs: ['id: Integer {id}', 'recipient_name: String', 'phone_number: String', 'province: String', 'district: String', 'ward: String [0..1]', 'street: String', 'ghn_district_id: Integer [0..1]', 'ghn_ward_code: String [0..1]', 'is_default: Boolean'] });
cls(dm, 'Shop', { x: C[0], y: 330, name: 'Shop', attrs: ['id: Integer {id}', 'name: String', 'slug: String {unique}', 'description: String [0..1]', 'pickup_address: String [0..1]', 'pickup_district_id: Integer [0..1]', 'status: ShopStatus'] });
cls(dm, 'Product', { x: C[2], y: 80, name: 'Product', attrs: ['id: Integer {id}', 'name: String', 'slug: String [0..1] {unique}', 'price: Decimal', 'currency: String', 'stock: Integer', 'condition: String', 'status: ProductStatus', 'sold_count: Integer'] });
cls(dm, 'Category', { x: C[3], y: 80, name: 'Category', attrs: ['id: Integer {id}', 'name: String {unique}', 'slug: String [0..1] {unique}', 'is_active: Boolean'] });
cls(dm, 'Review', { x: C[3], y: 220, name: 'Review', attrs: ['id: Integer {id}', 'user: User', 'order: Order [0..1]', 'rating: Integer', 'comment: String [0..1]', 'images: String [*]'] });
cls(dm, 'Cart', { x: C[3], y: 410, name: 'Cart', attrs: ['id: Integer {id}', 'user: User', 'quantity: Integer'] });
cls(dm, 'Order', { x: C[1], y: 400, name: 'Order', attrs: ['id: Integer {id}', 'order_code: String {unique}', 'total_amount: Decimal', 'shipping_fee: Decimal', 'final_amount: Decimal', 'status: OrderStatus', 'payment_method: PaymentMethod', 'is_paid: Boolean', 'paid_at: DateTime [0..1]', 'shipping_address: String'] });
cls(dm, 'OrderItem', { x: C[2], y: 400, name: 'OrderItem', attrs: ['id: Integer {id}', 'product_name: String', 'price: Decimal', 'quantity: Integer', 'subtotal: Decimal'] });
cls(dm, 'OrderShipment', { x: C[2], y: 560, name: 'OrderShipment', attrs: ['id: Integer {id}', 'seller: User', 'tracking_code: String [0..1]', 'cod_amount: Decimal', 'status: ShipmentStatus', 'delivered_at: DateTime [0..1]'] });
cls(dm, 'Payment', { x: C[0], y: 540, name: 'Payment', attrs: ['id: Integer {id}', 'user: User', 'amount: Decimal', 'payment_method: PaymentMethod', 'type: PaymentType', 'status: PaymentStatus', 'payos_order_code: String [0..1]', 'paid_at: DateTime [0..1]'] });
cls(dm, 'Escrow', { x: C[1], y: 700, name: 'Escrow', attrs: ['id: Integer {id}', 'buyer: User', 'seller: User', 'amount: Decimal', 'status: EscrowStatus', 'released_at: DateTime [0..1]'] });
cls(dm, 'Withdrawal', { x: C[3], y: 740, name: 'Withdrawal', attrs: ['id: Integer {id}', 'user: User', 'approved_by: User [0..1]', 'amount: Decimal', 'bank_name: String', 'bank_account: String', 'status: WithdrawalStatus', 'processed_at: DateTime [0..1]'] });
cls(dm, 'Wallet', { x: C[4], y: 740, name: 'Wallet', attrs: ['id: Integer {id}', 'user: User', 'balance: Decimal'] });
cls(dm, 'WalletTransaction', { x: C[5], y: 740, name: 'WalletTransaction', attrs: ['id: Integer {id}', 'type: TransactionType', 'amount: Decimal', 'balance_before: Decimal', 'balance_after: Decimal', 'reference: String [0..1]'] });
cls(dm, 'LedgerTransaction', { x: C[3], y: 560, name: 'LedgerTransaction', attrs: ['id: BigInt {id}', 'type: LedgerTxType', 'idempotency_key: String {unique}', 'reference_type: String [0..1]', 'reference_id: String [0..1]'] });
cls(dm, 'LedgerEntry', { x: C[4], y: 560, name: 'LedgerEntry', attrs: ['id: BigInt {id}', 'amount: BigInt', 'balance_after: BigInt'] });
cls(dm, 'LedgerAccount', { x: C[5], y: 560, name: 'LedgerAccount', attrs: ['id: BigInt {id}', 'owner_type: LedgerOwnerType', 'owner_id: String [0..1]', 'purpose: LedgerPurpose', 'balance: BigInt', 'version: Integer'] });
cls(dm, 'Conversation', { x: C[4], y: 80, name: 'Conversation', attrs: ['id: Integer {id}', 'buyer: User', 'seller: User', 'product: Product [0..1]'] });
cls(dm, 'Message', { x: C[5], y: 80, name: 'Message', attrs: ['id: Integer {id}', 'sender: User', 'content: String', 'images: String [*]', 'is_read: Boolean'] });
cls(dm, 'Notification', { x: C[4], y: 240, name: 'Notification', attrs: ['id: Integer {id}', 'user: User', 'type: NotificationType', 'title: String', 'content: String', 'is_read: Boolean'] });

const R = (k) => dm.boxes[k].x + dm.boxes[k].w, Lx = (k) => dm.boxes[k].x;
const T = (k) => dm.boxes[k].y, B = (k) => dm.boxes[k].y + dm.boxes[k].h;
const CX = (k) => dm.boxes[k].x + dm.boxes[k].w / 2;

link(dm, 'comp', 'User', 'Address', [[Lx('User'), 150], [R('Address'), 150]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'User', 'Shop', [[Lx('User'), 250], [300, 250], [300, 411], [R('Shop'), 411]], { ma: '1', mb: '0..1' });
link(dm, 'assoc', 'User', 'Product', [[R('User'), 150], [Lx('Product'), 150]], { ma: ['1', 'seller'], mb: '0..*' });
link(dm, 'assoc', 'Category', 'Product', [[Lx('Category'), 134], [R('Product'), 134]], { ma: '0..1', mb: '0..*' });
link(dm, 'assoc', 'Product', 'Review', [[R('Product'), 240], [Lx('Review'), 240]], { ma: '1', mb: '0..*' });
link(dm, 'assoc', 'Product', 'Cart', [[R('Product'), 265], [880, 265], [880, 455], [Lx('Cart'), 455]], { ma: '1', mb: '0..*' });
link(dm, 'assoc', 'User', 'Order', [[CX('User'), B('User')], [CX('User'), T('Order')]], { ma: ['1', 'buyer'], mb: '0..*' });
link(dm, 'comp', 'Order', 'OrderItem', [[R('Order'), 450], [Lx('OrderItem'), 450]], { ma: '1', mb: '1..*' });
link(dm, 'assoc', 'OrderItem', 'Product', [[CX('OrderItem'), T('OrderItem')], [CX('OrderItem'), B('Product')]], { ma: '0..*', mb: '0..1' });
link(dm, 'comp', 'Order', 'OrderShipment', [[R('Order'), 590], [Lx('OrderShipment'), 590]], { ma: '1', mb: '0..*' });
link(dm, 'assoc', 'Order', 'Payment', [[Lx('Order'), 590], [R('Payment'), 590]], { ma: '0..1', mb: '0..*' });
link(dm, 'assoc', 'Order', 'Escrow', [[CX('Order'), B('Order')], [CX('Order'), T('Escrow')]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'Wallet', 'WalletTransaction', [[R('Wallet'), 790], [Lx('WalletTransaction'), 790]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'LedgerTransaction', 'LedgerEntry', [[R('LedgerTransaction'), 610], [Lx('LedgerEntry'), 610]], { ma: '1', mb: '2..*' });
link(dm, 'assoc', 'LedgerAccount', 'LedgerEntry', [[Lx('LedgerAccount'), 610], [R('LedgerEntry'), 610]], { ma: '1', mb: '0..*' });
link(dm, 'comp', 'Conversation', 'Message', [[R('Conversation'), 120], [Lx('Message'), 120]], { ma: '1', mb: '0..*' });
check(dm);
frame(dm, 'class Zoldify Domain Model');

// =============================================================== page 2: enumerations
const en = page('Enumerations');
const enums = [
  ['UserRole', ['buyer', 'seller', 'admin', 'moderator']],
  ['ShopStatus', ['active', 'inactive', 'banned']],
  ['ProductStatus', ['DRAFT', 'PENDING', 'ACTIVE', 'SOLD', 'REJECTED']],
  ['OrderStatus', ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED', 'REFUNDED']],
  ['ShipmentStatus', ['CREATED', 'FAILED', 'DELIVERED', 'RECEIVED']],
  ['PaymentMethod', ['cod', 'bank_transfer', 'wallet', 'momo', 'vnpay', 'payos']],
  ['PaymentStatus', ['pending', 'success', 'failed']],
  ['PaymentType', ['order_payment', 'wallet_topup']],
  ['EscrowStatus', ['HOLDING', 'RELEASED', 'REFUNDED', 'CANCELLED']],
  ['WithdrawalStatus', ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']],
  ['TransactionType', ['TOPUP', 'PAYMENT', 'REFUND', 'WITHDRAWAL']],
  ['LedgerOwnerType', ['user', 'platform', 'external']],
  ['LedgerPurpose', ['AVAILABLE', 'ESCROW_HOLD', 'WITHDRAWAL_PENDING', 'REVENUE', 'GATEWAY_CLEARING', 'BANK_EXTERNAL']],
  ['LedgerTxType', ['TOPUP', 'ORDER_HOLD', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'WITHDRAWAL_APPROVE', 'WITHDRAWAL_COMPLETE', 'ADJUSTMENT']],
  ['NotificationType', ['ORDER_STATUS', 'REVIEW', 'PAYMENT', 'SYSTEM', 'MESSAGE', 'NEW_PRODUCT']],
];
const ENUM_W = 190, ENUM_GAP = 30, PER_ROW = 5;
let rowY = 80;
for (let i = 0; i < enums.length; i += PER_ROW) {
  const row = enums.slice(i, i + PER_ROW);
  const hs = row.map(([name, lits], k) => cls(en, name, { x: 40 + k * (ENUM_W + ENUM_GAP), y: rowY, w: ENUM_W, name, stereo: 'enumeration', attrs: lits }).h);
  rowY += Math.max(...hs) + 40;
}
check(en);
frame(en, 'class Zoldify Enumerations');

// =============================================================== page 3: money services
const sv = page('Money Services');
const SW = 370, SC = [70, 500, 930, 1360];
cls(sv, 'OrdersService', { x: SC[1], y: 80, w: SW, name: 'OrdersService', stereo: 'service', ops: ['+ create(dto: CreateOrderDto, user: IUser): Order', '+ updateStatus(id: Integer, dto: UpdateOrderDto, user: IUser): Order', '+ confirmShipmentReceived(orderId, sellerId, user)', '+ autoConfirmDueShipments(): {due, released}', '+ cancel(id: Integer, user: IUser): Order', '+ cancelExpired(orderId: Integer)'] });
cls(sv, 'WithdrawalsService', { x: SC[3], y: 80, w: SW, name: 'WithdrawalsService', stereo: 'service', ops: ['+ create(userId: Integer, dto): Withdrawal', '+ approve(id: Integer, adminId: Integer)', '+ reject(id: Integer, adminId: Integer, note?: String)', '+ complete(id: Integer, adminId: Integer)'] });
cls(sv, 'GhnService', { x: SC[0], y: 340, w: SW, name: 'GhnService', stereo: 'service', ops: ['+ calculateFee(dto): Integer', '+ createOrder(dto): GhnOrder', '+ getOrderStatus(orderCode: String): String [0..1]'] });
cls(sv, 'PayosService', { x: SC[1], y: 340, w: SW, name: 'PayosService', stereo: 'service', ops: ['+ createOrderPaymentLink(orderId, userId)', '+ createWalletTopupLink(amount, userId)', '+ handleWebhook(rawBody)', '+ refreshOrderStatus(orderId, userId)', '+ voidOpenLinkForOrder(orderId): Boolean'] });
cls(sv, 'EscrowsService', { x: SC[2], y: 340, w: SW, name: 'EscrowsService', stereo: 'service', ops: ['+ createOrderEscrows(orderId, manager?)', '+ release(orderId: Integer, sellerId?: Integer)', '+ refund(orderId: Integer, manager?)', '+ getHeldBalance(sellerId: Integer): Decimal'] });
cls(sv, 'NotificationsService', { x: SC[0], y: 600, w: SW, name: 'NotificationsService', stereo: 'service', ops: ['+ create(dto: CreateNotificationDto): Notification', '+ registerToken(user, token, platform?)', '+ markAsRead(id: Integer, user: IUser)'] });
cls(sv, 'LedgerService', { x: SC[2], y: 600, w: SW, name: 'LedgerService', stereo: 'service', ops: ['+ post(input: PostLedgerTxInput, manager?): LedgerTransaction', '+ getOrCreateAccount(ownerType, ownerId, purpose): LedgerAccount', '+ getBalance(ownerType, ownerId, purpose): BigInt'] });
cls(sv, 'PlatformFeeService', { x: SC[3], y: 600, w: SW, name: 'PlatformFeeService', stereo: 'service', ops: ['+ getPercent(manager?): Decimal', '+ computeFee(amount: BigInt, percent: Decimal): BigInt'] });

const sb = sv.boxes;
const sR = (k) => sb[k].x + sb[k].w, sL = (k) => sb[k].x, sT = (k) => sb[k].y, sB = (k) => sb[k].y + sb[k].h, sX = (k) => sb[k].x + sb[k].w / 2;
const U = { label: '«use»' };
// OrdersService fans out: left to GHN and notifications, down to PayOS, right to escrows
link(sv, 'use', 'OrdersService', 'NotificationsService', [[sL('OrdersService'), 120], [40, 120], [40, sT('NotificationsService') + 40], [sL('NotificationsService'), sT('NotificationsService') + 40]], U);
link(sv, 'use', 'OrdersService', 'GhnService', [[sL('OrdersService'), 160], [sX('GhnService'), 160], [sX('GhnService'), sT('GhnService')]], U);
link(sv, 'use', 'OrdersService', 'PayosService', [[sX('OrdersService'), sB('OrdersService')], [sX('OrdersService'), sT('PayosService')]], U);
link(sv, 'use', 'OrdersService', 'EscrowsService', [[sR('OrdersService'), 160], [sX('EscrowsService'), 160], [sX('EscrowsService'), sT('EscrowsService')]], U);
link(sv, 'use', 'PayosService', 'EscrowsService', [[sR('PayosService'), 400], [sL('EscrowsService'), 400]], U);
link(sv, 'use', 'PayosService', 'NotificationsService', [[sX('PayosService') - 60, sB('PayosService')], [sX('PayosService') - 60, sT('NotificationsService') + 60], [sR('NotificationsService'), sT('NotificationsService') + 60]], U);
link(sv, 'use', 'PayosService', 'LedgerService', [[sX('PayosService') + 60, sB('PayosService')], [sX('PayosService') + 60, sT('LedgerService') + 60], [sL('LedgerService'), sT('LedgerService') + 60]], U);
link(sv, 'use', 'EscrowsService', 'LedgerService', [[sX('EscrowsService'), sB('EscrowsService')], [sX('EscrowsService'), sT('LedgerService')]], U);
link(sv, 'use', 'EscrowsService', 'PlatformFeeService', [[sR('EscrowsService'), 400], [sX('PlatformFeeService'), 400], [sX('PlatformFeeService'), sT('PlatformFeeService')]], U);
const lowY = Math.max(sB('LedgerService'), sB('PlatformFeeService')) + 40;
link(sv, 'use', 'WithdrawalsService', 'LedgerService', [[sR('WithdrawalsService'), 120], [sR('WithdrawalsService') + 30, 120], [sR('WithdrawalsService') + 30, lowY], [sX('LedgerService'), lowY], [sX('LedgerService'), sB('LedgerService')]], U);
check(sv);
frame(sv, 'class Zoldify Money Services');

// =============================================================== write
const pages = [dm, en, sv];
const body = pages
  .map(
    (p, i) =>
      `  <diagram id="cd${i + 1}" name="${esc(p.name)}">\n    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.ceil(p.size.w)}" pageHeight="${Math.ceil(p.size.h)}" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
      p.cells.map((c) => '        ' + c).join('\n') +
      `\n      </root>\n    </mxGraphModel>\n  </diagram>`,
  )
  .join('\n');
fs.writeFileSync(OUT, `<mxfile host="app.diagrams.net" type="device">\n${body}\n</mxfile>\n`);
console.log(`${OUT}: ${pages.map((p) => p.name).join(', ')}`);
