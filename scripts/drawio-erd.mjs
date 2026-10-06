#!/usr/bin/env node
/**
 * Sinh 10-entity-relationship-diagram.drawio: ERD vật lý, ký pháp crow's foot.
 *
 * Cột lấy thẳng từ entity TypeORM (drawio-erd-model.mjs), không gõ tay: tên cột,
 * kiểu, PK / FK / UQ / NULL. Cột audit (created_at, updated_at, deleted_at) lược
 * đi cho gọn. Chia bốn trang theo vùng nghiệp vụ; bảng thuộc trang khác vẽ viền
 * nét đứt, chỉ giữ khoá chính, để đường quan hệ vẫn có chỗ bám.
 *
 * Đầu đường: || là đúng một, o| là không hoặc một, o< là không hoặc nhiều,
 * |< là một hoặc nhiều. Đường vẽ từ bảng cha sang bảng con.
 *
 *   node scripts/drawio-erd.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './drawio-lib.mjs';
import { page, cls, link, check, frame, writePages, STYLE, FONT } from './drawio-grid.mjs';
import { readEntities } from './drawio-erd-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', '10-entity-relationship-diagram.drawio');
const T = readEntities(path.join(ROOT, 'src'));

const W = 250;
const C = [40, 350, 660, 970, 1280];
const ER = (start, end) => `endFill=0;startFill=0;startSize=12;endSize=12;startArrow=${start};endArrow=${end};`;
Object.assign(STYLE, {
  one_many: ER('ERmandOne', 'ERzeroToMany'),
  opt_many: ER('ERzeroToOne', 'ERzeroToMany'),
  one_onemany: ER('ERmandOne', 'ERoneToMany'),
  one_opt: ER('ERmandOne', 'ERzeroToOne'),
});

/** Bảng đầy đủ: mỗi cột một dòng "tên  KIỂU  PK/FK/UQ/NULL". */
function table(pg, name, x, y, { crossRefs = {} } = {}) {
  const t = T[name];
  if (!t) throw new Error(`không có bảng ${name}`);
  const rows = t.columns.filter((c) => !c.audit).map((c) => {
    const flags = [c.pk && 'PK', c.fk && 'FK', c.unique && 'UQ', c.nullable && 'NULL'].filter(Boolean).join(' ');
    const ref = crossRefs[c.name] ? `  → ${crossRefs[c.name]}` : '';
    return `${c.name}  ${c.type}${flags ? '  ' + flags : ''}${ref}`;
  });
  for (const u of t.uniques) rows.push(`UQ (${u.join(', ')})`);
  return cls(pg, name, { x, y, w: W, name, attrs: rows });
}

/** Bảng thuộc trang khác: viền nét đứt, chỉ còn khoá chính. */
function ref(pg, name, x, y, area) {
  const pk = T[name].columns.find((c) => c.pk);
  return cls(pg, name, { x, y, w: W, name, attrs: [`${pk.name}  ${pk.type}  PK`, `(trang ${area})`], extra: 'dashed=1;' });
}

function note(pg, text, x, y, w) {
  const h = 18 + Math.ceil((text.length * 6.2) / (w - 20)) * 15;
  pg.boxes[`note-${y}`] = { x, y, w, h }; // so the page frame encloses it
  pg.cells.push(
    `<mxCell id="${pg.id()}" value="${esc(text)}" style="shape=note;whiteSpace=wrap;html=1;size=12;align=left;verticalAlign=middle;spacingLeft=8;spacingRight=8;fillColor=#FFFFFF;strokeColor=#000000;fontSize=11;${FONT}" vertex="1" parent="1">` +
      `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
  );
}

const geo = (pg) => {
  const b = (k) => pg.boxes[k];
  return {
    L: (k) => b(k).x, R: (k) => b(k).x + b(k).w, T: (k) => b(k).y, B: (k) => b(k).y + b(k).h,
    X: (k) => b(k).x + b(k).w / 2,
  };
};
const AUDIT = 'Cột audit (created_at, updated_at, deleted_at) lược đi. Viền nét đứt: bảng thuộc trang khác.';

// =============================================================== 1. identity & catalog
const p1 = page('Identity & Catalog');
table(p1, 'users', C[1], 80);
table(p1, 'addresses', C[0], 80);
table(p1, 'shops', C[0], 420);
table(p1, 'products', C[2], 80);
table(p1, 'categories', C[3], 80);
table(p1, 'reviews', C[3], 300, { crossRefs: { order_id: 'orders' } });
table(p1, 'carts', C[2], 490);
{
  const { L, R, T: Tp, B, X } = geo(p1);
  link(p1, 'one_many', 'users', 'addresses', [[L('users'), 150], [R('addresses'), 150]]);
  link(p1, 'one_opt', 'users', 'shops', [[L('users'), 320], [320, 320], [320, 470], [R('shops'), 470]]);
  link(p1, 'one_many', 'users', 'products', [[R('users'), 150], [L('products'), 150]]);
  link(p1, 'opt_many', 'categories', 'products', [[L('categories'), 130], [R('products'), 130]]);
  link(p1, 'one_many', 'products', 'reviews', [[R('products'), 360], [L('reviews'), 360]]);
  link(p1, 'one_many', 'products', 'carts', [[X('products'), B('products')], [X('products'), Tp('carts')]]);
  link(p1, 'one_many', 'users', 'carts', [[520, B('users')], [520, 544], [L('carts'), 544]]);
  link(p1, 'one_many', 'users', 'reviews', [[460, B('users')], [460, 640], [X('reviews'), 640], [X('reviews'), B('reviews')]]);
  check(p1);
  note(p1, AUDIT, C[2], 690, 560);
}
frame(p1, 'ERD: Identity & Catalog');

// =============================================================== 2. ordering
const p2 = page('Ordering');
ref(p2, 'users', C[0], 80, 'Identity & Catalog');
table(p2, 'orders', C[1], 80);
table(p2, 'order_items', C[2], 80);
ref(p2, 'products', C[3], 80, 'Identity & Catalog');
table(p2, 'order_shipments', C[2], 320);
{
  const { L, R, T: Tp, B, X } = geo(p2);
  link(p2, 'one_many', 'users', 'orders', [[R('users'), 110], [L('orders'), 110]]);
  link(p2, 'one_onemany', 'orders', 'order_items', [[R('orders'), 150], [L('order_items'), 150]]);
  link(p2, 'opt_many', 'products', 'order_items', [[L('products'), 110], [R('order_items'), 110]]);
  link(p2, 'one_many', 'orders', 'order_shipments', [[R('orders'), 400], [L('order_shipments'), 400]]);
  link(p2, 'one_many', 'users', 'order_shipments', [[X('users'), B('users')], [X('users'), 580], [X('order_shipments'), 580], [X('order_shipments'), B('order_shipments')]]);
  check(p2);
  note(p2, AUDIT + ' order_shipments: một vận đơn cho mỗi cặp (đơn, người bán).', C[3], 320, 400);
}
frame(p2, 'ERD: Ordering');

// =============================================================== 3. money
const p3 = page('Money');
table(p3, 'payos_webhook_logs', C[0], 80);
table(p3, 'payments', C[1], 80);
ref(p3, 'orders', C[2], 80, 'Ordering');
table(p3, 'escrows', C[3], 80);
ref(p3, 'users', C[2], 400, 'Identity & Catalog');
table(p3, 'wallets', C[1], 430);
table(p3, 'wallet_transactions', C[0], 430);
table(p3, 'withdrawals', C[3], 400);
table(p3, 'ledger_transactions', C[1], 680);
table(p3, 'ledger_entries', C[2], 680);
table(p3, 'ledger_accounts', C[3], 680);
{
  const { L, R, T: Tp, B } = geo(p3);
  link(p3, 'opt_many', 'orders', 'payments', [[L('orders'), 110], [R('payments'), 110]]);
  link(p3, 'one_many', 'orders', 'escrows', [[R('orders'), 110], [L('escrows'), 110]]);
  link(p3, 'one_many', 'users', 'payments', [[L('users'), 420], [630, 420], [630, 300], [R('payments'), 300]]);
  link(p3, 'one_opt', 'users', 'wallets', [[L('users'), 455], [R('wallets'), 455]]);
  link(p3, 'one_many', 'wallets', 'wallet_transactions', [[L('wallets'), 475], [R('wallet_transactions'), 475]]);
  // escrows.buyer_id and escrows.seller_id
  link(p3, 'one_many', 'users', 'escrows', [[830, Tp('users')], [830, 300], [1030, 300], [1030, B('escrows')]]);
  link(p3, 'one_many', 'users', 'escrows', [[860, Tp('users')], [860, 330], [1150, 330], [1150, B('escrows')]]);
  // withdrawals.user_id and withdrawals.approved_by
  link(p3, 'one_many', 'users', 'withdrawals', [[R('users'), 420], [L('withdrawals'), 420]]);
  link(p3, 'opt_many', 'users', 'withdrawals', [[R('users'), 455], [L('withdrawals'), 455]]);
  link(p3, 'one_onemany', 'ledger_transactions', 'ledger_entries', [[R('ledger_transactions'), 720], [L('ledger_entries'), 720]]);
  link(p3, 'one_many', 'ledger_accounts', 'ledger_entries', [[L('ledger_accounts'), 720], [R('ledger_entries'), 720]]);
  check(p3);
  note(p3, AUDIT + ' ledger_accounts.owner_id trỏ tới users khi owner_type = user, không có FK.', C[0], 680, 250);
}
frame(p3, 'ERD: Money');

// =============================================================== 4. messaging & social
const p4 = page('Messaging & Social');
ref(p4, 'products', C[1], 80, 'Identity & Catalog');
table(p4, 'conversations', C[2], 80);
table(p4, 'messages', C[3], 80);
ref(p4, 'users', C[2], 300, 'Identity & Catalog');
table(p4, 'notifications', C[1], 280);
table(p4, 'push_tokens', C[1], 490);
table(p4, 'follows', C[3], 280);
table(p4, 'files', C[2], 430);
table(p4, 'settings', C[3], 430);
{
  const { L, R, T: Tp, B, X } = geo(p4);
  link(p4, 'opt_many', 'products', 'conversations', [[R('products'), 110], [L('conversations'), 110]]);
  link(p4, 'one_many', 'conversations', 'messages', [[R('conversations'), 130], [L('messages'), 130]]);
  // conversations.buyer_id and conversations.seller_id
  link(p4, 'one_many', 'users', 'conversations', [[740, Tp('users')], [740, B('conversations')]]);
  link(p4, 'one_many', 'users', 'conversations', [[830, Tp('users')], [830, B('conversations')]]);
  link(p4, 'one_many', 'users', 'messages', [[880, Tp('users')], [880, 260], [1095, 260], [1095, B('messages')]]);
  link(p4, 'one_many', 'users', 'notifications', [[L('users'), 320], [R('notifications'), 320]]);
  link(p4, 'one_many', 'users', 'push_tokens', [[L('users'), 355], [630, 355], [630, 544], [R('push_tokens'), 544]]);
  // follows.follower_id and follows.following_id
  link(p4, 'one_many', 'users', 'follows', [[R('users'), 320], [L('follows'), 320]]);
  link(p4, 'one_many', 'users', 'follows', [[R('users'), 355], [L('follows'), 355]]);
  link(p4, 'one_many', 'users', 'files', [[X('users'), B('users')], [X('users'), Tp('files')]]);
  check(p4);
  note(p4, AUDIT + ' settings không có khoá ngoại.', C[3], 560, 560);
}
frame(p4, 'ERD: Messaging & Social');

writePages(OUT, [p1, p2, p3, p4]);
