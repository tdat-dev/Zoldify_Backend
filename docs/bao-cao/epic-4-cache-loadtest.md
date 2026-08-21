# Báo cáo Epic 4 — Chịu 1000 user đồng thời (pool + cache Redis)

**Người thực hiện:** Cường · **Ngày:** 2026-08-21 · **Nhánh:** `feat/epic-4-cache` → PR vào `staging`
**Trạng thái:** ĐANG LÀM (test-first: viết pre-mortem + load test trước khi code cache)

## 1. Mục tiêu
Chịu ~1000 user đồng thời không sập. Đòn bẩy: (a) pool DB có giới hạn — **đã có
`connectionLimit: 50`** trong `app.module.ts`; (b) **cache Redis** cho endpoint đọc-nhiều
để giảm tải DB; (c) **đo lại 1000 VU** so mốc cũ (baseline 99.55% pass).

## 2. Pre-mortem — Rủi ro & lỗi ẩn dự đoán (TRƯỚC khi code cache)
| # | Mức | Rủi ro | Cách chặn / chốt kiểm |
|---|-----|--------|------------------------|
| C1 | **CAO** | **Cache cũ (stale):** cache rồi dữ liệu đổi → user thấy dữ liệu lỗi thời. Nguy nhất với tiền/đơn. | CHỈ cache dữ liệu đọc-nhiều-đổi-ít: **catalog công khai** (`GET /products`, `GET /products/:id`, categories). TUYỆT ĐỐI KHÔNG cache orders/payments/ledger/notifications/chat (cá nhân, phải tươi). |
| C2 | **CAO** | **Rò dữ liệu giữa user:** cache 1 response trả nhầm cho user khác (endpoint phụ thuộc auth/quyền). | Chỉ cache endpoint `@Public()` không phụ thuộc user. Key cache gồm ĐỦ mọi tham số ảnh hưởng output (path + query: page, limit, filter). |
| C3 | **CAO** | **Redis chết kéo sập app:** nếu coi Redis là bắt buộc, Redis down → toàn API lỗi. | **Fail-open**: lỗi/timeout Redis → bỏ qua cache, đọc thẳng DB, KHÔNG throw. Có test tắt Redis vẫn phục vụ. |
| C4 | TB | **Invalidation sót:** update/create/delete product nhưng quên xoá cache → stale tới hết TTL. | Xoá key khi ghi đúng entity + **TTL ngắn làm lưới an toàn cuối** (vd 30–60s). |
| C5 | TB | **Thundering herd:** key hot hết hạn cùng lúc, 1000 request cùng miss đập DB. | TTL hợp lý + (tuỳ) jitter; đồ án: TTL + đo là đủ, ghi chú. |
| C6 | TB | **Đo sai (C7 cũ):** server+MySQL+Redis+k6 cùng 1 máy → nghẽn tài nguyên, số xấu không do code. | Ghi rõ điều kiện đo; **so tương đối trước/sau trên cùng máy**, không tuyên bố tuyệt đối. |
| C7 | Thấp | **Serialize:** Date/Decimal qua JSON vào cache rồi lệch kiểu khi đọc lại. | Cache tầng response đã serialize; kiểm 1 field kiểu Date/số khi so hit==DB. |

## 3. Test trước (đã viết, chạy được ngay — chưa cần Redis)
- `loadtest/catalog-load.js` — k6 1000 VU vào `GET /products` + `GET /products/:id` (đều
  `@Public()`). Ngưỡng "đạt": `http_req_failed < 1%`, `p95 < 500ms`. Chạy 2 lần:
  **trước cache = baseline**, **sau cache = bằng chứng cải thiện**.
- (sắp) `scripts/selfcheck-cache.ts` — biến C1/C3/C4 thành test: hit==DB, ghi→invalidate
  (không stale), tắt Redis→vẫn phục vụ (fail-open).

## 4. Vướng hạ tầng (nói thẳng)
Máy này **không có Docker, không có Redis** (chỉ có k6 + cache-manager). Hướng xử lý đề xuất:
cache **điều khiển bằng env** — có `REDIS_URL` thì dùng Redis (production), không có thì
rơi về **in-memory** (dev/test local). Cộng với fail-open (C3), logic cache test được ngay
tại máy không Redis; Redis chỉ cần khi muốn đo đúng đường production (Memurai/WSL/Docker).

## 5. Kết quả đo
**Bẫy phát hiện khi đo (quan trọng):** lần đầu 1000 VU → **98.96% lỗi 429** vì
`ThrottlerGuard` (300 req/60s MỖI IP) coi k6-từ-1-IP là một client lạm dụng. 1000 user
THẬT đến từ 1000 IP nên không dính. Đã sửa cách đo: k6 gắn `X-Forwarded-For` riêng theo VU
(app có `trust proxy=1` nên đọc XFF) = giả lập đúng 1000 IP → đo năng lực DB thật, không đo
rate limiter. Throttler GIỮ NGUYÊN trong production.

| Lần | VU | p95 | http_req_failed | throughput | ghi chú |
|-----|----|----|-----------------|-----------|---------|
| **Baseline (chưa cache)** | 1000 | **~58s** | **16.6%** (timeout >60s) | 9.5 req/s | DB sập dưới tải: mọi request đập products.findAll (COUNT 501k + offset) qua pool 50 |
| Sau cache Redis | 1000 | _chờ_ | _ | _ | _kỳ vọng p95 giảm mạnh do phần lớn phục vụ từ cache_ |

> Điều kiện đo (C6): server(prod build)+MySQL+k6 cùng 1 máy Windows; số dùng SO TƯƠNG ĐỐI
> trước/sau, không phải mốc tuyệt đối.
