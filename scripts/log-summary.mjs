/**
 * ĐỌC SỐ TỪ NHẬT KÝ — trả lời "p95 đang là bao nhiêu" mà không cần dịch vụ nào.
 *
 * Dùng:
 *   docker compose -p zoldify-staging logs --no-color api | node scripts/log-summary.mjs
 *   node scripts/log-summary.mjs < nhatky.log
 *   ... | node scripts/log-summary.mjs --top 10 --loi
 *
 * VÌ SAO CÓ FILE NÀY. Log JSON tự nó chưa trả lời được câu hỏi nào — nó chỉ mở
 * ra khả năng trả lời. Trước bài này, mọi con số hiệu năng của dự án đều đo trên
 * máy cá nhân; trên máy chủ không ai biết p95 của `/api/v1/products` là bao
 * nhiêu. Đây là cái cầu nối giữa "có log" và "biết chuyện gì đang xảy ra".
 *
 * Gom theo HÌNH DẠNG đường dẫn chứ không theo đường dẫn thô: `/products/12` và
 * `/products/948` là cùng một trang, để riêng thì mỗi cái một dòng và không
 * dòng nào đủ mẫu để nói được gì.
 */
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const soDong = Number(args[args.indexOf('--top') + 1]) || 20;
const chiLoi = args.includes('--loi');

/** `/api/v1/products/948?x=1` → `/api/v1/products/:id` */
function hinhDang(duong) {
  return String(duong)
    .split('?')[0]
    .split('/')
    .map((p) => {
      if (/^\d+$/.test(p)) return ':id';
      // Chuỗi dài lẫn số và chữ thường là mã, không phải tên trang.
      if (p.length > 24 && /\d/.test(p)) return ':ma';
      return p;
    })
    .join('/');
}

const bang = new Map();

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let tongDong = 0;
let boQua = 0;

for await (const dong of rl) {
  tongDong++;
  // `docker compose logs` gắn tiền tố "ten-container  | " vào đầu mỗi dòng.
  const dau = dong.indexOf('{');
  if (dau < 0) {
    boQua++;
    continue;
  }
  let o;
  try {
    o = JSON.parse(dong.slice(dau));
  } catch {
    boQua++;
    continue;
  }
  // Chỉ lấy dòng tóm tắt request; dòng log của service không có `method`.
  if (o.msg !== 'request' || !o.method) continue;

  const khoa = `${o.method} ${hinhDang(o.path)}`;
  let m = bang.get(khoa);
  if (!m) {
    m = { n: 0, loi: 0, ms: [] };
    bang.set(khoa, m);
  }
  m.n++;
  if (Number(o.status) >= 400) m.loi++;
  if (typeof o.ms === 'number') m.ms.push(o.ms);
}

const pct = (a, p) => {
  if (!a.length) return 0;
  const i = Math.min(a.length - 1, Math.floor((p / 100) * a.length));
  return a[i];
};

let hang = [...bang.entries()].map(([ten, m]) => {
  m.ms.sort((a, b) => a - b);
  return {
    ten,
    n: m.n,
    loi: m.loi,
    tiLeLoi: m.n ? (m.loi / m.n) * 100 : 0,
    p50: pct(m.ms, 50),
    p95: pct(m.ms, 95),
    p99: pct(m.ms, 99),
    tong: m.ms.reduce((s, x) => s + x, 0),
  };
});

if (chiLoi) hang = hang.filter((h) => h.loi > 0);

// Sắp theo TỔNG thời gian, không theo p95.
//
// Một route 2.000ms gọi 3 lần thì không đáng bận tâm; một route 40ms gọi 50.000
// lần mới là chỗ ăn hết máy chủ. Sắp theo p95 sẽ đẩy cái thứ nhất lên đầu và
// giấu cái thứ hai.
hang.sort((a, b) => b.tong - a.tong);

const so = (x, r = 0) => x.toFixed(r).padStart(8);
const tongReq = hang.reduce((s, h) => s + h.n, 0);
const tongLoi = hang.reduce((s, h) => s + h.loi, 0);

console.log(
  `\nĐọc ${tongDong.toLocaleString('vi-VN')} dòng · ` +
    `${tongReq.toLocaleString('vi-VN')} request · ` +
    `${tongLoi} lỗi (${tongReq ? ((tongLoi / tongReq) * 100).toFixed(1) : 0}%)` +
    (boQua ? ` · bỏ qua ${boQua} dòng không phải JSON` : ''),
);
if (tongReq === 0) {
  console.log(
    '\nKhông thấy dòng request nào. Log của ứng dụng có ở dạng JSON chưa?\n' +
      'Trên máy cá nhân log ở dạng người đọc — đặt LOG_JSON=1 để ép JSON.',
  );
  process.exit(0);
}

console.log(
  '\n' +
    'LƯỢT'.padStart(8) +
    'LỖI%'.padStart(8) +
    'p50'.padStart(8) +
    'p95'.padStart(8) +
    'p99'.padStart(8) +
    '  TỔNG(s)'.padStart(10) +
    '  ROUTE',
);
console.log('─'.repeat(96));
for (const h of hang.slice(0, soDong)) {
  console.log(
    so(h.n) +
      so(h.tiLeLoi, 1) +
      so(h.p50, 1) +
      so(h.p95, 1) +
      so(h.p99, 1) +
      so(h.tong / 1000, 1).padStart(10) +
      '  ' +
      h.ten,
  );
}
console.log(
  '\nSắp theo TỔNG thời gian: một route 40ms gọi 50.000 lượt ăn nhiều máy chủ\n' +
    'hơn một route 2.000ms gọi 3 lượt.\n',
);
