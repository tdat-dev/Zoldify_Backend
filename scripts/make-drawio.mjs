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
// 7. SYSTEM CONTEXT — C4 mức 1. Chương I của báo cáo.
// ===========================================================================
function contextDiagram() {
  const s = createSheet('System Context Diagram');

  const zoldify = vertex(s, {
    value: 'ZOLDIFY\nSecond-hand marketplace for students\nwith wallet and escrow',
    style: S.component + 'fontStyle=1;verticalAlign=middle;align=center;spacingLeft=0;',
    x: 480, y: 300, w: 320, h: 140,
  });

  const actor = (v, x, y) =>
    vertex(s, { value: v, style: S.actor, x, y, w: 30, h: 60 });
  const ext = (v, x, y) =>
    vertex(s, { value: v, style: S.artifact + 'align=center;spacingLeft=0;verticalAlign=middle;', x, y, w: 190, h: 60 });

  const buyer = actor('Buyer\n(student)', 90, 180);
  const seller = actor('Seller\n(student)', 90, 380);
  const admin = actor('Admin\n(operations)', 90, 580);

  const payos = ext('PayOS\npayment gateway', 1060, 100);
  const sepay = ext('SePay\nbank reconciliation', 1060, 190);
  const ghn = ext('GHN\nshipping', 1060, 280);
  const fcm = ext('Firebase FCM\npush notifications', 1060, 370);
  const r2 = ext('Cloudflare R2\nimage storage', 1060, 460);
  const smtp = ext('Gmail SMTP\nemail', 1060, 550);
  const bank = ext('Bank\nmanual payouts', 1060, 640);

  const f = (a, b, v) => edge(s, { source: a, target: b, value: v, style: S.flow });

  f(buyer, zoldify, 'browse · buy · pay · chat');
  f(seller, zoldify, 'list items · fulfil · withdraw');
  f(admin, zoldify, 'approve withdrawals · reconcile');

  f(zoldify, payos, 'create payment link');
  f(payos, zoldify, 'confirmation webhook');
  f(zoldify, sepay, 'match transfers');
  f(zoldify, ghn, 'create and track shipments');
  f(zoldify, fcm, 'send notifications');
  f(zoldify, r2, 'store and read images');
  f(zoldify, smtp, 'verification email');
  f(admin, bank, 'manual bank transfer');

  vertex(s, {
    value:
      'Payouts are MANUAL: an admin transfers the money and marks it done.\n' +
      'A deliberate choice at this scale — bank payout APIs need a registered\n' +
      'company. The ledger models it honestly with a withdrawal_pending account.',
    style: S.note,
    x: 420, y: 700, w: 480, h: 80,
  });

  return s;
}

// ===========================================================================
// 8. CONTAINER — C4 mức 2. Chương I và VI.
// ===========================================================================
function containerDiagram() {
  const s = createSheet('Container Diagram');

  const box = (v, x, y, w, h) =>
    vertex(s, { value: v, style: S.component + 'verticalAlign=middle;align=center;spacingLeft=0;', x, y, w, h });
  const store = (v, x, y) =>
    vertex(s, { value: v, style: S.node3d + 'verticalAlign=middle;align=center;spacingLeft=0;', x, y, w: 220, h: 90 });

  const web = box('Web\nNext.js 14 App Router, SSR', 60, 80, 240, 80);
  const app = box('Mobile\nReact Native + Expo\nAndroid and iOS', 60, 210, 240, 90);

  vertex(s, {
    value: 'Single VPS — Docker Compose',
    style: S.boundary, x: 400, y: 40, w: 640, h: 560,
  });

  const caddy = box('Caddy\nautomatic TLS, load balancing', 440, 90, 280, 70);
  const api = box('API x3\nNestJS, stateless', 440, 210, 280, 80);
  const worker = box('Worker x1\nBullMQ + cron', 760, 210, 240, 80);
  const mysql = store('MySQL 8\nsource of truth', 440, 340);
  const redis = store('Redis 7\ncache · throttle\nsocket adapter · queue', 760, 340);

  const r2 = box('Cloudflare R2\nproduct images', 440, 480, 280, 70);

  const f = (a, b, v, style = S.flow) => edge(s, { source: a, target: b, value: v, style });

  f(web, caddy, 'HTTPS /api/v1');
  f(app, caddy, 'HTTPS /api/v1');
  f(app, caddy, 'WebSocket /chat', S.depend);
  f(caddy, api, '');
  f(api, mysql, '');
  f(api, redis, '');
  f(worker, mysql, '');
  f(worker, redis, '');
  f(api, r2, 'upload', S.depend);

  vertex(s, {
    value:
      'Three things this diagram states:\n' +
      '1. The API keeps NO state, so it can be replicated. Everything that used to\n' +
      '   live in process memory — cache, rate-limit counters, socket lists — is in Redis.\n' +
      '2. Exactly ONE worker. Cron inside the API would run the reconciliation job\n' +
      '   three times; for a job that touches money that is a serious bug.\n' +
      '3. Images are not on the VPS disk. Required for replication, and so a redeploy\n' +
      '   does not wipe them.',
    style: S.note,
    x: 60, y: 640, w: 700, h: 120,
  });

  return s;
}

// ===========================================================================
// 9. COMPONENT — C4 mức 3, sáu bounded context và luật phụ thuộc.
// ===========================================================================
function componentDiagram() {
  const s = createSheet('Component Diagram - Bounded Contexts');

  const ctx = (v, x, y, w = 300, h = 90) =>
    vertex(s, { value: v, style: S.component + 'verticalAlign=middle;align=center;spacingLeft=0;', x, y, w, h });

  const ops = ctx('Ops\nadmin · settings · tasks', 420, 60);
  const ordering = ctx('Ordering\ncarts · orders · ghn', 80, 220);
  const money = ctx(
    'Money\nledger · wallets · escrows\npayments · payos · sepay · withdrawals',
    440, 220, 360, 100);
  const catalog = ctx(
    'Catalog\nproducts · categories · shop\nfiles · interactions · follows',
    80, 400, 320, 100);
  const messaging = ctx('Messaging\nchat · notifications · firebase', 840, 400, 300, 90);
  const identity = ctx('Identity\nauth · users · addresses', 400, 580, 320, 90);

  // Money tô đậm vì nó là context được bảo vệ chặt nhất
  vertex(s, {
    value: '',
    style: 'rounded=0;html=1;fillColor=none;strokeColor=#2C67C8;strokeWidth=3;dashed=1;',
    x: 425, y: 205, w: 390, h: 130,
  });

  const dep = (a, b) => edge(s, { source: a, target: b, style: S.flow });

  dep(ops, ordering);
  dep(ops, money);
  dep(ops, catalog);
  dep(ordering, catalog);
  dep(ordering, money);
  dep(ordering, identity);
  dep(catalog, identity);
  dep(messaging, identity);
  dep(money, identity);

  vertex(s, {
    value:
      'Arrows point DOWNWARD only. Identity is the foundation and depends on nobody.\n' +
      'Money depends only on Identity.\n\n' +
      'Money must NOT point at Ordering. Ordering computes the amount and calls Money,\n' +
      'passing a reference like {type: order, id: 123}. To Money that reference is an\n' +
      'opaque string — it does not know what an order is. That is what makes Money the\n' +
      'easiest context to split into its own service later.\n\n' +
      'The rule is enforced by eslint-plugin-boundaries, not by convention. Current\n' +
      'debt: 29 legacy violations, allowed to shrink but never to grow.',
    style: S.note,
    x: 80, y: 700, w: 660, h: 150,
  });

  vertex(s, {
    value: 'Money — the protected core.\nEvery balance change goes through LedgerService.post()',
    style: S.note,
    x: 860, y: 220, w: 300, h: 60,
  });

  return s;
}

// ===========================================================================
// 10. FUND FLOW — T-account. Slide 13 hoặc 14.
// ===========================================================================
function fundFlowDiagram() {
  const s = createSheet('Fund Flow Diagram');

  const acc = (v, x, y, fill) =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=12;whiteSpace=wrap;html=1;fontSize=12;verticalAlign=middle;' +
        `align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w: 230, h: 80,
    });

  const gateway = acc('gateway_clearing\nmoney arriving from PayOS', 60, 260, '#eef6ff');
  const buyer = acc('buyer.available\nbuyer wallet', 380, 100, '#ffffff');
  const hold = acc('escrow_hold\nheld by Zoldify', 380, 320, '#ffd700');
  const seller = acc('seller.available\nseller wallet', 720, 200, '#ffffff');
  const revenue = acc('platform.revenue\nZoldify revenue', 720, 420, '#90ee90');
  const pending = acc('seller.withdrawal_pending\nawaiting manual payout', 1050, 200, '#fff3cd');
  const bank = acc('bank_external\nleft the system', 1050, 380, '#e8e8e8');

  const f = (a, b, v, anchors = '') =>
    edge(s, { source: a, target: b, value: v, style: S.flow + anchors });

  // Hai cặp đi hai chiều giữa cùng một cặp hộp. Không tách điểm neo thì
  // draw.io vẽ chúng chồng khít lên nhau và hai nhãn dính thành một chuỗi
  // vô nghĩa.
  const DOWN_LEFT = 'exitX=0.3;exitY=1;entryX=0.3;entryY=0;';
  const UP_RIGHT = 'exitX=0.7;exitY=0;entryX=0.7;entryY=1;';
  const RIGHT_HIGH = 'exitX=1;exitY=0.3;entryX=0;entryY=0.3;';
  const LEFT_LOW = 'exitX=0;exitY=0.7;entryX=1;entryY=0.7;';

  f(gateway, buyer, '1 · wallet top-up');
  f(gateway, hold, '1b · order paid via PayOS',
    'exitX=1;exitY=0.75;entryX=0;entryY=0.5;');
  f(buyer, hold, '2 · place order', DOWN_LEFT);
  f(hold, buyer, '4 · refund', UP_RIGHT);
  f(hold, seller, '3a · delivered, 95%');
  f(hold, revenue, '3b · platform fee, 5%');
  f(seller, pending, '5 · seller requests', RIGHT_HIGH);
  f(pending, seller, '6a · rejected', LEFT_LOW);
  f(pending, bank, '6b · transfer completed');

  vertex(s, {
    value:
      'The yellow box is the single most important number in the system. Its balance\n' +
      'must always equal the real money sitting in Zoldify\'s bank account.\n\n' +
      'It answers the first question any auditor, investor or payment partner asks:\n' +
      '"How much of your users\' money are you holding, and how do you prove it?"\n' +
      'One SQL query. The old architecture could not answer it at all.\n\n' +
      'Steps 5 and 6 are separate because the payout is a human action. Between them\n' +
      'the money has left the seller\'s wallet but not the system — without a dedicated\n' +
      'account for that state, the books cannot be reconciled against the bank.',
    style: S.note,
    x: 60, y: 560, w: 720, h: 160,
  });

  return s;
}

// ===========================================================================
// 11 + 12. STATE MACHINE — vòng đời đơn hàng và ký quỹ. Chương III.
// ===========================================================================
function orderStateDiagram() {
  const s = createSheet('State Machine - Order Lifecycle');

  const st = (v, x, y, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=30;whiteSpace=wrap;html=1;fontSize=13;fontStyle=1;' +
        `verticalAlign=middle;align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w: 170, h: 55,
    });

  const start = vertex(s, { style: S.initial, x: 90, y: 60, w: 30, h: 30 });
  const pending = st('pending', 20, 160);
  const confirmed = st('confirmed', 20, 290);
  const processing = st('processing', 20, 420);
  const shipping = st('shipping', 20, 550);
  const delivered = st('delivered', 320, 550, '#d5f5dd');
  const cancelled = st('cancelled', 620, 160, '#ffe0e0');
  const refunded = st('refunded', 620, 400, '#ffe0e0');
  const done = vertex(s, { style: S.final, x: 900, y: 300, w: 30, h: 30 });

  const t = (a, b, v) => edge(s, { source: a, target: b, value: v, style: S.flow });

  t(start, pending, 'buyer places order');
  t(pending, confirmed, 'seller accepts');
  t(confirmed, processing, 'preparing goods');
  t(confirmed, shipping, 'ship directly');
  t(processing, shipping, 'GHN shipment created');
  t(shipping, delivered, 'buyer confirms receipt');
  t(pending, cancelled, 'cancel before acceptance');
  t(confirmed, cancelled, 'cancel after acceptance');
  t(delivered, refunded, 'admin refunds');
  t(cancelled, refunded, 'admin refunds');
  t(delivered, done, 'RELEASE escrow');
  t(refunded, done, 'REFUND escrow');
  t(cancelled, done, '');

  vertex(s, {
    value:
      'Every arrow into the final state moves money. That is why authorization on\n' +
      'this state machine is a financial control, not a UX detail.\n\n' +
      'Who may make each move — enforced by order-status.policy.ts:\n' +
      '  confirmed / processing / shipping ....... seller or admin\n' +
      '  delivered ............................... BUYER or admin, and only from shipping\n' +
      '  refunded ................................ admin only\n' +
      '  cancelled ............................... neither; use /cancel or /cancel-sale,\n' +
      '                                            those also restore stock\n\n' +
      'The principle: whoever gains must not be the one who presses the button.\n' +
      'A seller marking their own order delivered would be releasing their own escrow.',
    style: S.note,
    x: 20, y: 680, w: 700, h: 170,
  });

  return s;
}

function escrowStateDiagram() {
  const s = createSheet('State Machine - Escrow Lifecycle');

  const st = (v, x, y, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=30;whiteSpace=wrap;html=1;fontSize=13;fontStyle=1;' +
        `verticalAlign=middle;align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w: 170, h: 55,
    });

  const start = vertex(s, { style: S.initial, x: 95, y: 60, w: 30, h: 30 });
  const holding = st('holding', 25, 170, '#ffd700');
  const released = st('released', 400, 70, '#d5f5dd');
  const refunded = st('refunded', 400, 190, '#ffe0e0');
  const cancelled = st('cancelled', 400, 310, '#e8e8e8');
  const done = vertex(s, { style: S.final, x: 700, y: 185, w: 30, h: 30 });

  const t = (a, b, v) => edge(s, { source: a, target: b, value: v, style: S.flow });

  t(start, holding, 'order paid, money held');
  t(holding, released, 'order delivered');
  t(holding, refunded, 'order cancelled or refunded');
  t(holding, cancelled, 'payment window expired');
  t(released, done, '');
  t(refunded, done, '');
  t(cancelled, done, '');

  vertex(s, {
    value:
      'The escrow_hold balance must ALWAYS match the real bank account.\n' +
      'An hourly reconciliation job checks it.',
    style: S.note, x: 25, y: 300, w: 330, h: 55,
  });

  vertex(s, {
    value:
      'TERMINAL states. There is no way back.\n' +
      'To reverse one, post an opposite ledger transaction;\n' +
      'never edit the existing rows. ledger_entries is append-only.',
    style: S.note, x: 640, y: 60, w: 360, h: 70,
  });

  return s;
}

// ===========================================================================
// 13. SCREEN NAVIGATION — chương III, mục UI Design.
// ===========================================================================
function navigationDiagram() {
  const s = createSheet('Screen Navigation Diagram');

  const scr = (v, x, y, w = 170, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=14;whiteSpace=wrap;html=1;fontSize=12;verticalAlign=middle;' +
        `align=center;fillColor=${fill};strokeColor=#666666;`,
      x, y, w, h: 46,
    });

  const start = vertex(s, { style: S.initial, x: 75, y: 40, w: 30, h: 30 });
  const check = vertex(s, {
    value: 'Valid token?', style: S.decision, x: 20, y: 110, w: 150, h: 70,
  });

  vertex(s, { value: '(auth) — 4 screens', style: S.boundary, x: 20, y: 230, w: 380, h: 140 });
  const login = scr('log in', 40, 270);
  const register = scr('register', 220, 270);
  const forgot = scr('forgot password', 40, 320-10+16);
  const verify = scr('verify email', 220, 326);

  vertex(s, { value: '(tabs) — 5 screens', style: S.boundary, x: 20, y: 420, w: 380, h: 200 });
  const home = scr('home', 40, 460);
  const search = scr('search', 220, 460);
  const myorders = scr('my orders', 40, 520);
  const chatlist = scr('chat', 220, 520);
  const profile = scr('profile', 130, 570);

  const product = scr('product detail', 470, 460);
  const shop = scr('seller shop', 470, 400);
  const cart = scr('cart', 470, 520);
  const checkout = scr('checkout', 470, 580);
  const payos = scr('PayOS WebView', 470, 640, 170, '#fff3cd');
  const ret = scr('payment/return', 470, 700);
  const orderDetail = scr('order detail', 700, 520);
  const tracking = scr('GHN tracking', 700, 580);
  const room = scr('chat room', 700, 460);

  vertex(s, { value: 'seller/ — 9 screens', style: S.boundary, x: 940, y: 400, w: 400, h: 260 });
  const dash = scr('dashboard', 960, 440);
  const prods = scr('my products', 1150, 440);
  const newProd = scr('list an item', 960, 500);
  const editProd = scr('edit listing', 1150, 500);
  const sorders = scr('sales orders', 960, 560);
  const wallet = scr('wallet', 1150, 560);
  const withdraw = scr('withdraw', 960, 615);
  const txns = scr('transactions', 1150, 615);

  const settings = scr('settings and addresses', 700, 640, 200);

  const f = (a, b, v = '', style = S.flow) =>
    edge(s, { source: a, target: b, value: v, style });

  f(start, check);
  f(check, login, 'no');
  f(check, home, 'yes');
  f(login, home, '');
  f(home, product);
  f(search, product);
  f(product, shop);
  f(product, cart);
  f(cart, checkout);
  f(checkout, payos);
  f(payos, ret, 'deep link', S.depend);
  f(ret, orderDetail);
  f(myorders, orderDetail);
  f(orderDetail, tracking);
  f(chatlist, room);
  f(profile, dash);
  f(profile, settings);

  vertex(s, {
    value:
      'The deep link zoldify://payment/return only navigates the UI. The single source\n' +
      'of truth for "this was paid" is the PayOS webhook hitting the backend — a user\n' +
      'can close the browser before being redirected, and a URL can be typed by hand.\n\n' +
      'The seller block is roughly half the total app work. Cut to 5 core screens\n' +
      'because the team is four people; sellers keep the full flow on the web.',
    style: S.note,
    x: 20, y: 700, w: 620, h: 110,
  });

  return s;
}

// ===========================================================================
// 14. CI/CD PIPELINE — phụ lục báo cáo.
// ===========================================================================
function cicdDiagram() {
  const s = createSheet('Deployment Pipeline');

  const step = (v, x, y, w = 220, fill = '#ffffff') =>
    vertex(s, {
      value: v,
      style:
        'rounded=1;arcSize=20;whiteSpace=wrap;html=1;fontSize=12;verticalAlign=middle;' +
        `align=center;fillColor=${fill};strokeColor=#333333;`,
      x, y, w, h: 50,
    });

  const dev = step('Developer pushes\na feature branch', 60, 60);
  const pr = step('Open Pull Request', 60, 150);

  vertex(s, { value: 'CI checks — all must pass', style: S.boundary, x: 340, y: 40, w: 560, h: 330 });
  const c1 = step('lint + typecheck', 370, 90, 240);
  const c2 = step('boundaries:check\nblocks context violations', 370, 155, 240, '#ffe8cc');
  const c3 = step('test\n37 tests, money on real MySQL', 370, 220, 240);
  const c4 = step('build', 640, 90, 230);
  const c5 = step('openapi:check\ndiffers from commit means fail', 640, 155, 230, '#ffe8cc');
  const c6 = step('diagrams:check\n25 diagrams must parse', 640, 220, 230, '#ffe8cc');

  const gate = vertex(s, {
    value: 'All green?', style: S.decision, x: 500, y: 290, w: 160, h: 70,
  });

  const review = step('Reviewed by\nanother member', 990, 150, 220);
  const merge = step('Merge into develop', 990, 240, 220);
  const main = step('Merge develop into main', 990, 330, 220);
  const build = step('Build image,\npush to GHCR', 990, 420, 220);
  const deploy = step('SSH to VPS\ncompose pull and up -d', 990, 510, 220);
  const migrate = step('Run migrations\nseparate step, has a rollback', 990, 600, 220);
  const health = vertex(s, {
    value: '/api/v1/health\nok?', style: S.decision, x: 1010, y: 690, w: 180, h: 80,
  });
  const rollback = step('Roll back to\nprevious image', 700, 700, 220, '#ffe0e0');
  const done = step('Done', 1010, 810, 180, '#d5f5dd');

  const f = (a, b, v = '') => edge(s, { source: a, target: b, value: v, style: S.flow });

  f(dev, pr);
  f(pr, c1);
  f(gate, dev, 'no');
  f(gate, review, 'yes');
  f(review, merge);
  f(merge, main);
  f(main, build);
  f(build, deploy);
  f(deploy, migrate);
  f(migrate, health);
  f(health, rollback, 'fails');
  f(health, done, 'ok');

  vertex(s, {
    value:
      'The three orange gates are what makes the architecture hold over time.\n\n' +
      'boundaries:check turns the context dependency rule from a spoken agreement\n' +
      'into a merge blocker. Without it the rule is broken within two weeks.\n\n' +
      'openapi:check guarantees web and mobile never build against a stale contract.\n\n' +
      'diagrams:check means a broken diagram cannot be merged — the report depends\n' +
      'on them rendering.\n\n' +
      'NOT BUILT YET: the backend has no .github/workflows at all. This is B, week 1.',
    style: S.note,
    x: 60, y: 420, w: 620, h: 180,
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

  // Không có slide riêng trong mẫu, nhưng cần cho báo cáo và cho việc hiểu
  // hệ thống. Đặt tên mô tả thay vì số slide.
  ['r1-system-context.drawio', [contextDiagram()], { width: 1350, height: 820 }],
  ['r2-container.drawio', [containerDiagram()], { width: 1120, height: 800 }],
  ['r3-component-bounded-contexts.drawio', [componentDiagram()], { width: 1250, height: 890 }],
  ['r4-fund-flow.drawio', [fundFlowDiagram()], { width: 1350, height: 760 }],
  ['r5-state-order-lifecycle.drawio', [orderStateDiagram()], { width: 1000, height: 880 }],
  ['r6-state-escrow-lifecycle.drawio', [escrowStateDiagram()], { width: 1050, height: 400 }],
  ['r7-screen-navigation.drawio', [navigationDiagram()], { width: 1400, height: 840 }],
  ['r8-cicd-pipeline.drawio', [cicdDiagram()], { width: 1280, height: 890 }],
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
