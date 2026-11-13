// Đo chất lượng trợ lý mua hàng trên một môi trường thật (mặc định staging).
//
//   node scripts/assistant-eval/run.mjs [--runs 3] [--base https://api-staging.zoldify.com/api/v1] [--skip 35] [--only 5]
//
// Mỗi câu chạy nhiều lần vì mô hình trả lời mỗi lần một khác: câu "điện thoại
// iphone" từng lúc ra 6 món, lúc ra rỗng tuỳ mô hình trả "iPhone" hay "điện thoại
// iPhone". Chấm:
//   - đúng loại: tên mỗi món chứa một cụm trong `any` (so không dấu)
//   - đủ món: ít nhất `min` món; câu `empty` thì phải rỗng
//   - giá: món trong tầm không quá `max`, món vượt ngân sách không quá 30%
//   - thời gian lượt chat, lượt nhận xét
//   - câu AI không mâu thuẫn nhãn giá (nhãn rẻ mà câu nói "cao hơn" là mâu thuẫn)
// Route bị giới hạn 15 lượt/phút mỗi IP nên mỗi lượt cách nhau hơn 4 giây.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'https://api-staging.zoldify.com/api/v1');
const RUNS = Number(arg('runs', '3'));
const ONLY = arg('only', '');
const GAP_MS = 4_200;
const { cases } = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8'));

const bare = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) => {
  const t = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ms: Date.now() - t, data: json.data };
};

// Câu AI nói ngược nhãn giá server đã tính.
const contradicts = (verdict, note) => {
  const n = bare(note);
  if (verdict === 'good') return /cao hon|dat hon/.test(n);
  if (verdict === 'high') return /thap hon|re hon/.test(n);
  return false;
};

function grade(c, chat) {
  const errors = [];
  const products = chat.data?.products ?? [];
  if (chat.status !== 200) errors.push(`HTTP ${chat.status}`);
  if (c.empty) {
    if (products.length) errors.push(`phải rỗng, ra ${products.length} món`);
    if (c.reply && !new RegExp(c.reply).test(bare(chat.data?.reply ?? '')))
      errors.push(`câu trả lời thiếu "${c.reply}": ${chat.data?.reply}`);
    return errors;
  }
  if (products.length < (c.min ?? 1)) errors.push(`ra ${products.length} món, cần ≥ ${c.min ?? 1}`);
  for (const p of products) {
    if (c.any?.length && !c.any.some((k) => bare(p.name).includes(k)))
      errors.push(`sai loại: ${p.name}`);
    const cap = c.max && (p.over_budget ? c.max * 1.3 : c.max);
    if (cap && p.price > cap) errors.push(`quá giá: ${p.name} ${p.price}`);
    if (c.minPrice && p.price < c.minPrice) errors.push(`dưới giá: ${p.name} ${p.price}`);
  }
  // Món đứng đầu phải đúng ý nhất ("macbook m1" thì món đầu phải là M1).
  if (c.top && products[0] && !bare(products[0].name).includes(c.top))
    errors.push(`món đầu sai: ${products[0].name}`);
  if (c.sorted === 'asc') {
    const inBudget = products.filter((p) => !p.over_budget).map((p) => p.price);
    if (inBudget.some((v, i) => i && v < inBudget[i - 1])) errors.push('không xếp giá tăng dần');
  }
  if (c.reply && !new RegExp(c.reply).test(bare(chat.data?.reply ?? '')))
    errors.push(`câu trả lời thiếu "${c.reply}": ${chat.data?.reply}`);
  return errors;
}

const rows = [];
const SKIP = Number(arg('skip', '0'));
const list = cases.slice(SKIP, ONLY ? SKIP + Number(ONLY) : undefined);
for (let run = 1; run <= RUNS; run++) {
  for (const c of list) {
    const messages = [];
    for (const h of c.history ?? []) {
      messages.push({ role: 'user', content: h });
      messages.push({ role: 'assistant', content: `Mình tìm được vài món "${h}".` });
    }
    messages.push({ role: 'user', content: c.q });
    const chat = await post('/assistant/chat', { messages });
    const errors = grade(c, chat);
    let review = null;
    if (chat.data?.review_id) {
      await sleep(1_100);
      const r = await post('/assistant/review', { review_id: chat.data.review_id });
      const notes = r.data?.notes ?? {};
      const products = chat.data.products;
      const clash = products.filter((p) => notes[p.id] && contradicts(p.verdict, notes[p.id]));
      review = {
        ms: r.ms,
        coverage: products.length ? Object.keys(notes).length / products.length : 0,
        clash: clash.map((p) => `${p.name} [${p.verdict}] ${notes[p.id]}`),
      };
    }
    rows.push({
      run,
      q: c.q,
      ms: chat.ms,
      n: chat.data?.products?.length ?? 0,
      q_used: chat.data?.filters?.q ?? null,
      fallback: chat.data?.fallback ?? null,
      errors,
      review,
    });
    const mark = errors.length ? 'FAIL' : 'ok  ';
    console.log(
      `${mark} r${run} ${(chat.ms / 1000).toFixed(1)}s n=${rows.at(-1).n} q="${c.q}" -> "${rows.at(-1).q_used}"` +
        (review ? ` review ${(review.ms / 1000).toFixed(1)}s ${Math.round(review.coverage * 100)}%` : '') +
        (errors.length ? `\n      ${errors.slice(0, 3).join('\n      ')}` : '') +
        (review?.clash.length ? `\n      MÂU THUẪN: ${review.clash.join(' | ')}` : ''),
    );
    await sleep(GAP_MS);
  }
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};
const chatMs = rows.map((r) => r.ms);
const reviews = rows.filter((r) => r.review);
const flaky = [...new Set(rows.map((r) => r.q))].filter((qq) => {
  const rs = rows.filter((r) => r.q === qq);
  return rs.some((r) => r.errors.length) && rs.some((r) => !r.errors.length);
});
const summary = {
  base: BASE,
  at: new Date().toISOString(),
  runs: RUNS,
  calls: rows.length,
  pass: pct(rows.filter((r) => !r.errors.length).length, rows.length),
  chat_p50_s: q(chatMs, 0.5) / 1000,
  chat_p95_s: q(chatMs, 0.95) / 1000,
  chat_max_s: Math.max(...chatMs) / 1000,
  over_10s: rows.filter((r) => r.ms > 10_000).length,
  review_p50_s: q(reviews.map((r) => r.review.ms), 0.5) / 1000,
  review_coverage: pct(
    reviews.reduce((s, r) => s + r.review.coverage, 0),
    reviews.length,
  ),
  review_clash: reviews.reduce((s, r) => s + r.review.clash.length, 0),
  fallback: rows.filter((r) => r.fallback).length,
  flaky,
  failed: [...new Set(rows.filter((r) => r.errors.length).map((r) => r.q))],
};
console.log('\n' + JSON.stringify(summary, null, 2));
writeFileSync(
  join(here, `ket-qua-${summary.at.slice(0, 16).replace(/[:T]/g, '-')}.json`),
  JSON.stringify({ summary, rows }, null, 2),
);
