/**
 * Baseline đo tải 1000 user đồng thời (Task 0.2 — Epic 0).
 *
 * Mục đích: ghi lại HIỆN TRẠNG (p95, tỉ lệ lỗi, throughput) TRƯỚC khi tối ưu, để
 * các Epic sau có mốc mà so sánh. Bắn vào hai đường đọc nặng nhất:
 *   - GET /products  (công khai, 500k sản phẩm, có phân trang + tìm kiếm FULLTEXT)
 *   - GET /orders    (cần đăng nhập)
 *
 * Chạy (mở terminal MỚI sau khi đã cài k6, và BẬT server trước — npm run start:dev):
 *   k6 run load-test/baseline.js
 *
 * Tuỳ chỉnh:
 *   k6 run -e VUS=1000 -e BASE_URL=http://localhost:3000/api/v1 load-test/baseline.js
 *   k6 run -e VUS=200  load-test/baseline.js      # thử nhẹ trước cho chắc
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const TARGET = Number(__ENV.VUS || 1000);
// Rút ngắn được khi smoke test: -e RAMP=5s -e HOLD=10s
const RAMP = __ENV.RAMP || '30s';
const HOLD = __ENV.HOLD || '1m';

// Số liệu tách riêng từng endpoint để đọc p95 cho dễ.
const productsDur = new Trend('products_duration', true);
const ordersDur = new Trend('orders_duration', true);
const errors = new Rate('errors');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: TARGET }, // tăng dần tới 1000 VU
        { duration: HOLD, target: TARGET }, // giữ tải
        { duration: '15s', target: 0 }, // hạ về 0
      ],
      gracefulRampDown: '10s',
    },
  },
  // Ngưỡng "đạt": tự đánh giá pass/fail. Đây là mốc baseline, đừng kỳ vọng pass
  // ngay — chính chỗ FAIL cho biết cần tối ưu ở đâu.
  thresholds: {
    http_req_failed: ['rate<0.05'], // dưới 5% request lỗi
    products_duration: ['p(95)<1000'], // /products p95 < 1s
    orders_duration: ['p(95)<2000'], // /orders   p95 < 2s
  },
};

// Chạy MỘT lần trước khi bắn: đăng nhập lấy token dùng chung cho mọi VU.
export function setup() {
  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: 'buyer@zoldify.com', password: '123456' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const token = res.json('data.access_token');
  if (!token) {
    throw new Error(`Đăng nhập thất bại (${res.status}). Body: ${res.body}`);
  }
  return { token };
}

export default function (data) {
  // 1) /products — công khai, trang ngẫu nhiên, 30% có kèm tìm kiếm
  const current = Math.floor(Math.random() * 100) + 1;
  const q = Math.random() < 0.3 ? '&q=San%20pham' : '';
  const p = http.get(`${BASE}/products?current=${current}&pageSize=20${q}`, {
    tags: { name: 'products' },
  });
  productsDur.add(p.timings.duration);
  const pOk = check(p, { 'products status 200': (r) => r.status === 200 });
  errors.add(!pOk);

  // 2) /orders — cần token
  const o = http.get(`${BASE}/orders?currentPage=1&limit=20&as=buyer`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { name: 'orders' },
  });
  ordersDur.add(o.timings.duration);
  const oOk = check(o, { 'orders status 200': (r) => r.status === 200 });
  errors.add(!oOk);

  sleep(1); // mỗi VU nghỉ 1s giữa hai vòng — mô phỏng người dùng thật
}
