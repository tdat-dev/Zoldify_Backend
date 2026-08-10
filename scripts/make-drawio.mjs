#!/usr/bin/env node
/**
 * Sinh sáu sơ đồ .drawio bắt buộc cho buổi bảo vệ.
 *
 * Thứ tự lấy đúng theo "Project Presentation Template.pdf" (15 slide):
 *   slide 5  Use Case          slide 9   Sequence
 *   slide 6  Activity          slide 10  Entity Relationship
 *   slide 8  Class             slide 11  Deployment
 *
 *   node scripts/make-drawio.mjs
 *
 * Ghi ra docs/system-design/drawio/. Script KHÔNG ghi đè file đã có — sau lần
 * sinh đầu, file .drawio là bản gốc, sửa thẳng trong draw.io. Muốn dựng lại từ
 * đầu thì xoá file rồi chạy lại.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFile,
  createSheet,
  edge,
  edgeAt,
  S,
  umlClass,
  vertex,
} from './drawio-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio');
const FORCE = process.argv.includes('--force');

// ===========================================================================
// 1. USE CASE DIAGRAM  — slide 5
// ===========================================================================
function useCaseDiagram() {
  const s = createSheet('Use Case Diagram');

  // Bố cục theo cụm: use case của ai thì đặt ngang tầm người đó. Không làm
  // vậy thì 22 đường liên kết cắt nhau thành lưới, in ra không đọc được.
  const buyer = vertex(s, { value: 'Buyer', style: S.actor, x: 70, y: 250, w: 30, h: 60 });
  const seller = vertex(s, { value: 'Seller', style: S.actor, x: 70, y: 830, w: 30, h: 60 });
  const admin = vertex(s, { value: 'Admin', style: S.actor, x: 1230, y: 300, w: 30, h: 60 });
  const payos = vertex(s, { value: 'PayOS', style: S.actor, x: 1230, y: 520, w: 30, h: 60 });
  const ghn = vertex(s, { value: 'GHN', style: S.actor, x: 1230, y: 750, w: 30, h: 60 });

  vertex(s, {
    value: 'Zoldify',
    style: S.boundary,
    x: 250, y: 50, w: 900, h: 1110,
  });

  const uc = (value, x, y) =>
    vertex(s, { value, style: S.useCase, x, y, w: 230, h: 54 });

  // Cột trái, nửa trên — chỉ người mua dùng
  const u2 = uc('Search products', 320, 110);
  const u3 = uc('Manage cart', 320, 190);
  const u4 = uc('Place order', 320, 270);
  const u5 = uc('Top up wallet', 320, 350);
  const u6 = uc('Track order', 320, 430);
  const u7 = uc('Confirm delivery received', 320, 510);

  // Giữa — hai bên cùng dùng, đặt giữa hai actor cho đường ngắn đều
  const u1 = uc('Register / Log in', 320, 620);
  const u8 = uc('Send messages', 320, 700);

  // Cột trái, nửa dưới — chỉ người bán dùng
  const u9 = uc('List an item for sale', 320, 810);
  const u10 = uc('Manage sales orders', 320, 890);
  const u12 = uc('View wallet and transactions', 320, 970);
  const u13 = uc('Request withdrawal', 320, 1050);

  // Cột phải — của các actor bên phải
  const u14 = uc('Approve withdrawal', 780, 270);
  const u15 = uc('Reconcile the ledger', 780, 350);
  const u16 = uc('Manage users', 780, 430);
  const u17 = uc('Process payment webhook', 780, 540);
  const u11 = uc('Create shipment', 780, 770);

  const link = (a, b) => edge(s, { source: a, target: b, style: S.assoc });

  [u1, u2, u3, u4, u5, u6, u7, u8].forEach((u) => link(buyer, u));
  [u1, u8, u9, u10, u11, u12, u13].forEach((u) => link(seller, u));
  [u14, u15, u16].forEach((u) => link(admin, u));
  link(payos, u17);
  link(ghn, u11);

  // Đặt hàng luôn kéo theo xử lý thanh toán; xác nhận nhận hàng luôn kéo
  // theo việc ghi sổ vào ví người bán.
  edge(s, { source: u4, target: u17, value: '«include»', style: S.depend });
  edge(s, { source: u7, target: u12, value: '«include»', style: S.depend });

  vertex(s, {
    value:
      'Actors are stick figures and use cases are ellipses, as required by UML.\n' +
      'The system boundary separates what Zoldify does from who asks for it.\n' +
      'Buyer-only cases sit at the top, seller-only cases at the bottom, and the\n' +
      'two shared cases in between, so the association lines stay short.',
    style: S.note,
    x: 250, y: 1190, w: 520, h: 85,
  });

  return s;
}

// ===========================================================================
// 2. ACTIVITY DIAGRAM — slide 6. Đặt hàng và thanh toán.
// ===========================================================================
function activityDiagram() {
  const s = createSheet('Activity Diagram - Place Order and Pay');

  // Ba làn bơi dọc = ba partition của UML.
  // Làn giữa rộng hơn vì nhánh lỗi phải nằm CẠNH nhánh chính, không được
  // chồng lên hình thoi.
  const laneH = 1320;
  const l1 = vertex(s, { value: 'Buyer', style: S.laneV, x: 40, y: 40, w: 400, h: laneH });
  const l2 = vertex(s, { value: 'Zoldify Backend', style: S.laneV, x: 440, y: 40, w: 660, h: laneH });
  const l3 = vertex(s, { value: 'PayOS', style: S.laneV, x: 1100, y: 40, w: 340, h: laneH });

  // Toạ độ trong làn là tương đối so với làn
  const act = (lane, v, x, y, w = 300, h = 50, style = S.action) =>
    vertex(s, { value: v, style, x, y, w, h, parent: lane });

  // Trục chính của làn giữa: hành động x=40 w=360, hình thoi x=130 w=180.
  // Cả hai cùng tâm 220. Nhánh lỗi để riêng ở x=460.
  const start = vertex(s, { style: S.initial, x: 175, y: 60, w: 30, h: 30, parent: l1 });
  const a1 = act(l1, 'Review cart and press Checkout', 40, 120);
  const a2 = act(l1, 'Fill in receiver name, phone, address', 40, 200);
  const a3 = act(l1, 'Choose payment method', 40, 280);
  const a4 = act(l1, 'Pay on the PayOS page', 40, 730);
  const endN = vertex(s, { style: S.final, x: 175, y: 1230, w: 30, h: 30, parent: l1 });

  const b1 = act(l2, 'Lock product rows and verify stock', 40, 120, 360);
  const d1 = vertex(s, {
    value: 'All items\nin stock?',
    style: S.decision, x: 130, y: 210, w: 180, h: 90, parent: l2,
  });
  const rollback = act(l2, 'Roll back,\nno order created', 460, 220, 180, 60, S.actionTodo);

  const b2 = act(l2, 'Compute totals, insert order and items,\ndecrement stock', 40, 350, 360, 60);
  const d2 = vertex(s, {
    value: 'Payment\nmethod?',
    style: S.decision, x: 130, y: 450, w: 180, h: 90, parent: l2,
  });
  const b3 = act(l2, 'Create PayOS payment link', 40, 590, 360);

  const b4 = act(l2, 'Verify webhook signature', 40, 830, 360);
  const d3 = vertex(s, {
    value: 'Idempotency key\nalready used?',
    style: S.decision, x: 130, y: 920, w: 180, h: 90, parent: l2,
  });
  const b5 = act(
    l2,
    'ONE TRANSACTION\nledger entries · order marked paid · escrow rows per seller',
    40, 1060, 360, 80, S.actionDone,
  );

  const fork = vertex(s, { style: S.bar, x: 70, y: 1170, w: 300, h: 6, parent: l2 });
  const n1 = act(l2, 'Notify sellers', 40, 1200, 170, 40);
  const n2 = act(l2, 'Create GHN shipment', 230, 1200, 170, 40);

  const p1 = act(l3, 'Return checkout URL and QR code', 20, 650, 300);
  const p2 = act(l3, 'Send confirmation webhook', 20, 830, 300);

  const f = (a, b, v = '') => edge(s, { source: a, target: b, value: v, style: S.flow });

  f(start, a1);
  f(a1, a2);
  f(a2, a3);
  f(a3, b1);
  f(b1, d1);
  f(d1, rollback, 'no');
  f(d1, b2, 'yes');
  f(b2, d2);
  f(d2, b3, 'PayOS');
  f(b3, p1);
  f(p1, a4);
  f(a4, p2);
  f(p2, b4);
  f(b4, d3);
  f(d3, b5, 'no');
  f(b5, fork);
  f(fork, n1);
  f(fork, n2);
  f(n1, endN);
  f(n2, endN);
  // Nhánh COD bỏ qua toàn bộ phần thanh toán. Ép nó đi vòng sát mép trái làn
  // giữa bằng waypoint tuyệt đối — để draw.io tự định tuyến thì đường cắt
  // thẳng qua ô "Verify webhook signature" và nhãn đè lên chữ trong ô đó.
  edge(s, {
    source: d2, target: fork, value: 'Cash on delivery', style: S.flow,
    points: [[490, 535], [490, 1213]],
  });
  f(d3, endN, 'yes, ignore');
  f(rollback, endN);

  vertex(s, {
    value:
      'The thick black bar is a UML fork node: once the payment commits,\n' +
      'notifying the sellers and creating the shipment run in parallel.\n' +
      'Green marks the step that is already implemented; red is the failure path.',
    style: S.note,
    x: 40, y: 1400, w: 520, h: 80,
  });

  return s;
}

// ===========================================================================
// 3. CLASS DIAGRAM — slide 8
// ===========================================================================
function classDiagram() {
  const s = createSheet('Class Diagram');

  const user = umlClass(s, {
    value: 'User', x: 40, y: 60,
    attrs: ['+ id: int', '+ full_name: string', '+ email: string', '- password: string',
      '+ role: UserRole', '+ email_verified: bool'],
    methods: ['+ isSeller(): bool', '+ canModerate(): bool'],
  });

  const product = umlClass(s, {
    value: 'Product', x: 40, y: 400,
    attrs: ['+ id: int', '+ name: string', '+ price: decimal', '+ stock: int',
      '+ status: ProductStatus'],
    methods: ['+ isAvailable(): bool', '+ decreaseStock(qty): void'],
  });

  const category = umlClass(s, {
    value: 'Category', x: 40, y: 700,
    attrs: ['+ id: int', '+ name: string', '+ slug: string'],
  });

  const order = umlClass(s, {
    value: 'Order', x: 400, y: 60,
    attrs: ['+ id: int', '+ order_code: string', '+ final_amount: decimal',
      '+ status: OrderStatus', '+ is_paid: bool', '+ tracking_code: string'],
    methods: ['+ canTransitionTo(next): bool', '+ isCancellable(): bool'],
  });

  const orderItem = umlClass(s, {
    value: 'OrderItem', x: 400, y: 400,
    attrs: ['+ id: int', '+ product_name: string', '+ price: decimal',
      '+ quantity: int', '+ subtotal: decimal'],
  });

  const payment = umlClass(s, {
    value: 'Payment', x: 400, y: 640,
    attrs: ['+ id: int', '+ amount: decimal', '+ status: PaymentStatus',
      '+ payos_order_code: string'],
  });

  const escrow = umlClass(s, {
    value: 'Escrow', x: 760, y: 60,
    attrs: ['+ id: int', '+ amount: decimal', '+ status: EscrowStatus',
      '+ released_at: datetime'],
    methods: ['+ isReleasable(): bool'],
  });

  const ledgerTx = umlClass(s, {
    value: 'LedgerTransaction', x: 760, y: 320,
    attrs: ['+ id: bigint', '+ type: LedgerTxType', '+ idempotency_key: string',
      '+ reference_type: string', '+ reference_id: bigint'],
  });

  const ledgerEntry = umlClass(s, {
    value: 'LedgerEntry', x: 760, y: 600,
    attrs: ['+ id: bigint', '+ amount: bigint', '+ balance_after: bigint'],
  });

  const ledgerAcc = umlClass(s, {
    value: 'LedgerAccount', x: 1120, y: 600,
    attrs: ['+ id: bigint', '+ owner_type: LedgerOwnerType', '+ owner_id: bigint',
      '+ purpose: LedgerPurpose', '+ balance: bigint'],
  });

  const ledgerSvc = umlClass(s, {
    value: 'LedgerService', x: 1120, y: 60,
    attrs: ['- dataSource: DataSource'],
    methods: [
      '+ post(input, manager?): LedgerTransaction',
      '+ getBalance(type, id, purpose): bigint',
      '+ getOrCreateAccount(...): LedgerAccount',
      '- lockAccounts(em, ids): Map',
    ],
  });

  const withdrawal = umlClass(s, {
    value: 'Withdrawal', x: 1120, y: 350,
    attrs: ['+ id: int', '+ amount: decimal', '+ bank_account: string',
      '+ status: WithdrawalStatus'],
  });

  const rel = (a, b, v, style = 'endArrow=open;endFill=0;html=1;fontSize=11;') =>
    edge(s, { source: a, target: b, value: v, style });

  const compose =
    'endArrow=open;endFill=0;startArrow=diamondThin;startFill=1;startSize=12;html=1;fontSize=11;';

  rel(user, product, '1  sells  0..*');
  rel(user, order, '1  places  0..*');
  rel(user, withdrawal, '1  requests  0..*');
  rel(category, product, '1  classifies  0..*');
  edge(s, { source: order, target: orderItem, value: '1        1..*', style: compose });
  rel(product, orderItem, '1  appears in  0..*');
  rel(order, payment, '1  paid by  0..*');
  rel(order, escrow, '1  splits into  1..*');
  rel(escrow, user, 'held for seller');
  edge(s, { source: ledgerTx, target: ledgerEntry, value: '1        2..*', style: compose });
  rel(ledgerAcc, ledgerEntry, '1  records  0..*');
  edge(s, { source: ledgerSvc, target: ledgerTx, value: '«creates»', style: S.depend });
  edge(s, { source: escrow, target: ledgerSvc, value: '«uses»', style: S.depend });
  edge(s, { source: withdrawal, target: ledgerSvc, value: '«uses»', style: S.depend });

  vertex(s, {
    value:
      'LedgerService has no table of its own — it is the only class\n' +
      'allowed to change a balance. That is what a Class Diagram\n' +
      'shows and an ERD cannot: behaviour, not just storage.',
    style: S.note,
    x: 1120, y: 850, w: 400, h: 70,
  });

  return s;
}

// ===========================================================================
// 4. SEQUENCE DIAGRAM — slide 9. Webhook PayOS chống lặp.
// ===========================================================================
function sequenceDiagram() {
  const s = createSheet('Sequence Diagram - PayOS Webhook');

  const TOP = 60;
  const LIFE_H = 900;

  // Tâm mỗi lifeline. Thông điệp vẽ từ tâm sang tâm nên phải giữ lại con số.
  const L = {
    payos: 130,
    api: 400,
    ledger: 680,
    db: 950,
    notif: 1220,
  };
  const lane = (v, cx, w) =>
    vertex(s, { value: v, style: S.lifeline, x: cx - w / 2, y: TOP, w, h: LIFE_H });

  lane('PayOS', L.payos, 150);
  lane('PayosService', L.api, 180);
  lane('LedgerService', L.ledger, 180);
  lane('MySQL', L.db, 150);
  lane('NotificationsService', L.notif, 200);

  // Hộp kích hoạt đặt bằng toạ độ tuyệt đối cho khớp với thông điệp
  const bar = (cx, y, h) =>
    vertex(s, { style: S.activation, x: cx - 5, y, w: 10, h });

  bar(L.api, 150, 640);
  bar(L.ledger, 250, 400);
  bar(L.db, 290, 330);
  bar(L.notif, 760, 40);

  const m = (from, to, y, v, style = S.msg) =>
    edgeAt(s, { x1: from, y1: y, x2: to, y2: y, value: v, style });

  /** Thông điệp tự gọi chính mình — vẽ thành móc vuông */
  const self = (cx, y, v) => {
    edgeAt(s, {
      x1: cx + 5, y1: y, x2: cx + 5, y2: y + 30, value: v,
      style: S.msg + 'edgeStyle=orthogonalEdgeStyle;rounded=0;exitX=1;exitY=0;entryX=1;entryY=0;',
    });
  };

  m(L.payos, L.api, 150, '1. POST /api/v1/payos/webhook');
  self(L.api, 190, '2. verify signature');
  m(L.api, L.ledger, 250, '3. post(key = payos:orderCode:linkId, manager)');
  m(L.ledger, L.db, 290, '4. BEGIN TRANSACTION');
  m(L.ledger, L.db, 330, '5. SELECT ledger_transactions WHERE idempotency_key');
  m(L.db, L.ledger, 370, '6. found / not found', S.ret);
  m(L.ledger, L.db, 500, '7. INSERT transaction, INSERT entries');
  m(L.ledger, L.db, 540, '8. SELECT ledger_accounts FOR UPDATE, UPDATE balance');
  m(L.ledger, L.db, 580, '9. UPDATE orders, INSERT escrows');
  m(L.ledger, L.db, 620, '10. COMMIT');
  m(L.ledger, L.api, 660, '11. LedgerTransaction', S.ret);
  m(L.api, L.notif, 780, '12. notify buyer, after commit');
  m(L.api, L.payos, 830, '13. 200 OK', S.ret);

  // Khung alt bao các bước 7-10, tức nhánh "khoá còn mới".
  // Tab của umlFrame rộng theo tham số width trong style; để mặc định 80 thì
  // nhãn dài bị bẻ dòng tràn xuống thân khung.
  vertex(s, {
    value: 'alt  [key is new]',
    style: S.frame.replace('width=80', 'width=190'),
    x: 590, y: 470, w: 480, h: 200,
  });

  vertex(s, {
    value:
      'Steps 4 to 10 are ONE transaction. The idempotency key and the money share a fate:\n' +
      'a crash rolls both back, so the retry succeeds cleanly. The old code committed the\n' +
      'key first, so a crash silently swallowed the payment.',
    style: S.note,
    x: 60, y: 990, w: 660, h: 80,
  });

  vertex(s, {
    value:
      'else [key already used]\n' +
      'Return the existing transaction and move no money.\n' +
      'This is the normal path when PayOS resends, not an error.',
    style: S.note,
    x: 780, y: 990, w: 540, h: 80,
  });

  return s;
}

// ===========================================================================
// 5. ENTITY RELATIONSHIP DIAGRAM — slide 10
// ===========================================================================
function erDiagram() {
  const s = createSheet('Entity Relationship Diagram');

  const ent = (value, x, y, cols) =>
    umlClass(s, { value, x, y, w: 300, attrs: cols });

  const users = ent('users', 40, 60, [
    'PK  id: int',
    '     email: varchar(150)  UNIQUE',
    '     password: varchar(255)',
    '     role: enum',
    '     email_verified: tinyint',
  ]);

  const orders = ent('orders', 420, 60, [
    'PK  id: int',
    '     order_code: varchar(50)  UNIQUE',
    'FK  user_id: int',
    '     final_amount: decimal(15,2)',
    '     status: enum',
    '     is_paid: tinyint',
  ]);

  const orderItems = ent('order_items', 420, 340, [
    'PK  id: int',
    'FK  order_id: int',
    'FK  product_id: int',
    '     quantity: int',
    '     subtotal: decimal(15,2)',
  ]);

  const products = ent('products', 40, 340, [
    'PK  id: int',
    'FK  seller_id: int',
    'FK  category_id: int',
    '     price: decimal(15,2)',
    '     stock: int',
    '     status: enum',
  ]);

  const escrows = ent('escrows', 800, 60, [
    'PK  id: int',
    'FK  order_id: int',
    'FK  buyer_id: int',
    'FK  seller_id: int',
    '     amount: decimal(15,2)',
    '     status: enum',
  ]);

  const ledgerTx = ent('ledger_transactions', 800, 340, [
    'PK  id: bigint',
    '     type: enum',
    '     idempotency_key: varchar(191)  UNIQUE',
    '     reference_type: varchar(50)',
    '     reference_id: bigint',
  ]);

  const ledgerEntries = ent('ledger_entries', 800, 600, [
    'PK  id: bigint',
    'FK  transaction_id: bigint',
    'FK  account_id: bigint',
    '     amount: bigint',
    '     balance_after: bigint',
  ]);

  const ledgerAccounts = ent('ledger_accounts', 420, 600, [
    'PK  id: bigint',
    '     owner_type: enum',
    '     owner_id: bigint',
    '     purpose: enum',
    '     balance: bigint',
  ]);

  // Ký pháp chân chim: một-nhiều
  const oneMany =
    'endArrow=ERmany;startArrow=ERone;endFill=0;startFill=0;html=1;fontSize=11;';

  const r = (a, b, v) => edge(s, { source: a, target: b, value: v, style: oneMany });

  r(users, orders, 'places');
  r(users, products, 'sells');
  r(orders, orderItems, 'contains');
  r(products, orderItems, 'appears in');
  r(orders, escrows, 'splits into');
  r(ledgerTx, ledgerEntries, 'balances to zero');
  r(ledgerAccounts, ledgerEntries, 'records');
  r(users, ledgerAccounts, 'owns');

  vertex(s, {
    value:
      'ledger_entries is append-only: no column may be updated.\n' +
      'To reverse a transaction, post the opposite one.\n' +
      'idempotency_key is UNIQUE at the database level, not in code.',
    style: S.note,
    x: 40, y: 640, w: 340, h: 70,
  });

  return s;
}

// ===========================================================================
// 6. DEPLOYMENT DIAGRAM — slide 11. Node hộp 3D theo UML.
// ===========================================================================
function deploymentDiagram() {
  const s = createSheet('Deployment Diagram');

  const dev = vertex(s, {
    value: '«device»\nUser Device',
    style: S.node3d, x: 40, y: 80, w: 260, h: 220,
  });
  vertex(s, { value: 'Browser\n(Next.js web client)', style: S.artifact, x: 60, y: 150, w: 210, h: 55 });
  vertex(s, { value: 'Android / iOS app\n(React Native, Expo)', style: S.artifact, x: 60, y: 215, w: 210, h: 55 });

  const vps = vertex(s, {
    value: '«device»\nVPS — Ubuntu, Docker Compose',
    style: S.node3d, x: 420, y: 40, w: 620, h: 530,
  });

  vertex(s, { value: '«container»  caddy:2\nTLS termination, reverse proxy, :80 :443',
    style: S.artifact, x: 450, y: 120, w: 560, h: 55 });

  const apiNode = vertex(s, {
    value: '«execution environment»\nNode.js 20 — API replicas',
    style: S.node3d, x: 450, y: 200, w: 560, h: 150,
  });
  vertex(s, { value: 'zoldify-api  x3\nNestJS, stateless, mem_limit 512M',
    style: S.artifact, x: 475, y: 265, w: 250, h: 60 });
  vertex(s, { value: 'zoldify-worker  x1\nBullMQ + cron, mem_limit 256M',
    style: S.artifact, x: 740, y: 265, w: 245, h: 60 });

  vertex(s, { value: '«database»  mysql:8\nmax_connections 200, volume mysql_data',
    style: S.artifact, x: 450, y: 380, w: 270, h: 65 });
  vertex(s, { value: '«database»  redis:7\ncache, throttle, socket adapter, queue',
    style: S.artifact, x: 740, y: 380, w: 270, h: 65 });

  vertex(s, { value: 'cron on host\ndaily mysqldump, 14-day retention',
    style: S.artifact, x: 450, y: 470, w: 270, h: 55 });

  const cf = vertex(s, {
    value: '«device»\nCloudflare R2',
    style: S.node3d, x: 1140, y: 120, w: 240, h: 130,
  });
  vertex(s, { value: 'product images\ndatabase backups', style: S.artifact, x: 1165, y: 185, w: 190, h: 50 });

  const gw = vertex(s, {
    value: '«device»\nPayOS / GHN / FCM',
    style: S.node3d, x: 1140, y: 320, w: 240, h: 120,
  });
  vertex(s, { value: 'external HTTPS APIs', style: S.artifact, x: 1165, y: 385, w: 190, h: 35 });

  const gh = vertex(s, {
    value: '«device»\nGitHub Actions',
    style: S.node3d, x: 1140, y: 520, w: 240, h: 120,
  });
  vertex(s, { value: 'build image, push GHCR', style: S.artifact, x: 1165, y: 585, w: 190, h: 35 });

  const link = (a, b, v) => edge(s, { source: a, target: b, value: v, style: S.flow });
  link(dev, vps, 'HTTPS  /api/v1\nWebSocket  /chat');
  link(vps, cf, 'S3 API');
  link(vps, gw, 'HTTPS');
  link(gh, vps, 'SSH  compose pull && up -d');

  vertex(s, {
    value:
      'UML deployment notation: nodes are 3D boxes, artifacts sit inside them.\n' +
      'Three API replicas are only possible because every piece of state\n' +
      'lives in MySQL, Redis or R2 — never in process memory or on local disk.',
    style: S.note,
    x: 420, y: 780, w: 620, h: 80,
  });

  return s;
}

// ===========================================================================

// Kích thước trang đặt riêng từng sơ đồ. Để mặc định thì draw.io vẽ đường
// ngắt trang cắt ngang hình, và lúc export ra ảnh sẽ bị xén.
const FILES = [
  ['05-use-case-diagram.drawio', [useCaseDiagram()], { width: 1400, height: 1320 }],
  ['06-activity-diagram.drawio', [activityDiagram()], { width: 1500, height: 1520 }],
  ['08-class-diagram.drawio', [classDiagram()], { width: 1600, height: 1000 }],
  ['09-sequence-diagram.drawio', [sequenceDiagram()], { width: 1400, height: 1110 }],
  ['10-entity-relationship-diagram.drawio', [erDiagram()], { width: 1200, height: 920 }],
  ['11-deployment-diagram.drawio', [deploymentDiagram()], { width: 1450, height: 780 }],
];

fs.mkdirSync(OUT, { recursive: true });

let written = 0;
let skipped = 0;
for (const [name, sheets, size] of FILES) {
  const target = path.join(OUT, name);
  if (fs.existsSync(target) && !FORCE) {
    console.log(`  bỏ qua  ${name}  (đã có, dùng --force để ghi đè)`);
    skipped += 1;
    continue;
  }
  fs.writeFileSync(target, buildFile(sheets, size), 'utf8');
  console.log(`  ghi     ${name}`);
  written += 1;
}

console.log(
  `\n${written} file mới, ${skipped} file giữ nguyên. Thư mục: ${path.relative(ROOT, OUT)}`,
);
