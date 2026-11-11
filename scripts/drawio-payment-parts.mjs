#!/usr/bin/env node
/**
 * Sinh 13-payment-parts.drawio: trang Payment của Sequence-Diagrams tách làm hai
 * trang vừa khung slide (webhook, rồi ghi sổ). Trang gốc cao gần 9000 px, chiếu
 * nguyên trang thì chữ chỉ còn vài pt, mà cắt ảnh ra thì không còn là bản draw.io.
 *
 * Đọc thẳng scripts/drawio-specs/sequence/07-payment.json nên đổi luồng ở spec là
 * hai trang này đổi theo. Không đụng Sequence-Diagrams.drawio: file đó nhóm đã
 * sửa tay (4da2d59), sinh lại sẽ mất các chỉnh đó.
 *
 *   node scripts/drawio-payment-parts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFile } from './drawio-lib.mjs';
import { render, htmlText } from './drawio-sequence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'scripts', 'drawio-specs', 'sequence', '07-payment.json');
const OUT = path.join(ROOT, 'docs', 'system-design', 'drawio', '13-payment-parts.drawio');

const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
// 12/10 nhóm bỏ các ghi chú trên trang sequence, hai trang này theo đúng vậy
const steps = spec.steps.filter((s) => !s.note);
const lane = (ids) => spec.lifelines.filter((l) => ids.includes(l.id));

const start = steps.findIndex((s) => s.label?.startsWith('POST /payos/webhook'));
const alt = steps.findIndex((s, i) => i > start && s.frag === 'alt');
if (start < 0 || alt < 0) throw new Error('07-payment.json đổi cấu trúc, sửa lại chỗ tách trang');
const paid = steps[alt].operands.find((o) => o.guard === '[else]');
if (!paid) throw new Error('không thấy nhánh [else] (ghi nhận thanh toán) trong khối alt');

// Trang 1: webhook từ đầu tới cuối; nhánh ghi sổ thu lại thành một ref sang trang 2.
const webhook = steps.slice(start).map((s, i) =>
  i !== alt - start ? s : {
    ...s,
    operands: s.operands.map((o) => (o !== paid ? o : {
      ...o,
      steps: [o.steps[0], { ref: 'applyPaidPayment: ledger posting (next page)', over: ['svc', 'db'] }],
    })),
  });

const sheets = [
  render(htmlText({ name: 'Payment Webhook', title: 'PayOS webhook (detail)', lifelines: lane(['app', 'ctl', 'svc', 'db', 'po']), steps: webhook })),
  render(htmlText({ name: 'Payment Ledger', title: 'applyPaidPayment: ledger posting (detail)', lifelines: lane(['svc', 'esc', 'led', 'db']), steps: paid.steps })),
];
const W = Math.max(...sheets.map((s) => s.size.w)), H = Math.max(...sheets.map((s) => s.size.h));
fs.writeFileSync(OUT, buildFile(sheets, { width: Math.ceil(W), height: Math.ceil(H) }));
console.log(`${OUT}: ${sheets.map((s) => s.name).join(', ')}`);
