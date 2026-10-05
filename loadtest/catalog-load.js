/**
 * Load test Epic 4 — catalog công khai dưới tải cao (acceptance test).
 *
 * Đo endpoint đọc-nhiều KHÔNG cần token: GET /products, GET /products/:id.
 * Chạy 2 lần cùng điều kiện: TRƯỚC cache = baseline, SAU cache Redis = bằng chứng.
 *
 * Chạy:
 *   k6 run loadtest/catalog-load.js
 *   k6 run -e TARGET_VU=1000 -e BASE_URL=http://localhost:3000 loadtest/catalog-load.js
 *
 * Ngưỡng "ĐẠT" (test đỏ nếu vi phạm):
 *   - http_req_failed  < 1%   (gần như không lỗi)
 *   - p95 < 500ms             (95% request dưới nửa giây)
 *
 * LƯU Ý ĐO (pre-mortem C6): server + MySQL + (Redis) + k6 chạy CÙNG 1 máy → tài
 * nguyên bị chia. Con số dùng để SO TƯƠNG ĐỐI trước/sau, không phải mốc tuyệt đối.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

// Server có prefix 'api' + version 'v1' → base thật là /api/v1.
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const TARGET_VU = Number(__ENV.TARGET_VU || 1000);

export const options = {
  scenarios: {
    catalog: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: TARGET_VU }, // tăng dần tới đích
        { duration: '40s', target: TARGET_VU }, // giữ tải đỉnh
        { duration: '10s', target: 0 }, //         hạ tải
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // < 1% lỗi
    http_req_duration: ['p(95)<500'], // p95 < 500ms
  },
};

// setup() lấy sẵn danh sách id CÓ THẬT để phần test detail không sinh 404 giả.
export function setup() {
  const res = http.get(`${BASE_URL}/products?pageSize=100`);
  const ids = [];
  try {
    const body = JSON.parse(res.body);
    const rows = (body.data && body.data.result) || [];
    for (const r of rows) if (r && r.id != null) ids.push(r.id);
  } catch (e) {
    // để mảng rỗng — phần detail sẽ tự bỏ qua
  }
  if (ids.length === 0) {
    console.warn('setup: không lấy được id sản phẩm — chỉ đo danh sách');
  }
  return { ids };
}

// App có ThrottlerGuard (300 req/60s MỖI IP) + trust proxy=1. k6 chạy từ 1 IP
// localhost nên 1000 VU sẽ bị coi là MỘT client → 429 hàng loạt (sai bản chất:
// 1000 user thật đến từ 1000 IP). Gắn X-Forwarded-For riêng theo VU = giả lập
// đúng 1000 IP khác nhau. Mỗi VU nghỉ 0.5–1.5s nên ~<60 req/phút < 300, không tự
// dính throttle — đo đúng năng lực DB/cache thay vì đo rate limiter.
function vuHeaders() {
  const vu = __VU; // 1..TARGET_VU
  const ip = `10.${Math.floor(vu / 256) % 256}.${vu % 256}.${1 + (vu % 250)}`;
  return { 'X-Forwarded-For': ip };
}

export default function (data) {
  const headers = vuHeaders();
  const r = Math.random();
  if (r < 0.7) {
    // 70% duyệt danh sách (trang nông, giống người dùng thật)
    const page = 1 + Math.floor(Math.random() * 5);
    const res = http.get(`${BASE_URL}/products?current=${page}&pageSize=20`, {
      headers,
      tags: { name: 'products_list' },
    });
    check(res, { 'list 200': (x) => x.status === 200 });
  } else if (r < 0.95 && data.ids.length > 0) {
    // 25% xem chi tiết 1 sản phẩm có thật
    const id = data.ids[Math.floor(Math.random() * data.ids.length)];
    const res = http.get(`${BASE_URL}/products/${id}`, {
      headers,
      tags: { name: 'product_detail' },
    });
    check(res, { 'detail 200': (x) => x.status === 200 });
  } else {
    // 5% trang sâu hơn (áp lực OFFSET / cache miss)
    const page = 20 + Math.floor(Math.random() * 50);
    const res = http.get(`${BASE_URL}/products?current=${page}&pageSize=20`, {
      headers,
      tags: { name: 'products_deep' },
    });
    check(res, { 'deep 200': (x) => x.status === 200 });
  }
  sleep(0.5 + Math.random()); // nghỉ 0.5–1.5s như người dùng thật
}
