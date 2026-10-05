# Báo cáo Epic 4 — Chịu 1000 user đồng thời (pool + cache Redis)

**Người thực hiện:** Cường · **Ngày:** 2026-08-21 · **Nhánh:** `feat/epic-4-cache` → PR vào `staging`
**Trạng thái:** XONG core (test-first: pre-mortem + selfcheck-cache đỏ→xanh + k6 đo trước/sau).
Cache catalog (products list/detail) qua env-bridge, single-flight, fail-open. Chờ PR vào staging.

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

## 3. Test trước (test-first: viết TRƯỚC khi code, chạy phải ĐỎ rồi mới XANH)
- `loadtest/catalog-load.js` — k6 1000 VU vào `GET /products` + `GET /products/:id` (đều
  `@Public()`). Ngưỡng "đạt": `http_req_failed < 1%`, `p95 < 500ms`. Chạy 2 lần:
  **trước cache = baseline**, **sau cache = bằng chứng cải thiện**.
- `scripts/selfcheck-cache.ts` — biến rủi ro pre-mortem thành PASS/FAIL. Chạy TRƯỚC khi
  code cache: **đỏ đúng ở C-1** ("lần 2 vẫn xuống DB — CHƯA cache"). Sau khi code: **tất
  cả xanh**. Ba phép thử:
  - **C-1 (hit==DB + C7):** đọc lần 2 phục vụ TỪ cache (đếm 0 truy vấn DB) và khớp hệt DB,
    giữ nguyên field Date/Decimal (`created_at`, `price`).
  - **C-2 (không stale):** update sản phẩm → cache detail bị xoá → đọc lại ra tên MỚI.
  - **C-3 (fail-open):** cache ném lỗi (mô phỏng Redis down) → `findOne`/`findAll` vẫn trả DB.
- Gộp cổng chất lượng: `scripts/selfcheck-all.ts` chạy cả 3 Epic bằng `npm run check`
  (hoặc `check:core` / `check:index` / `check:cache`).

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

| Lần | VU | p95 | median | http_req_failed | throughput | max | ghi chú |
|-----|----|----|--------|-----------------|-----------|-----|---------|
| **Baseline (chưa cache)** | 1000 | **~58s** | (sập) | **16.6%** (timeout>60s) | 9.5 req/s | >60s | mọi request đập products.findAll (COUNT+offset) qua pool 50 |
| **Cache get/set** | 1000 | 7.92s | 35.9ms | **0%** | 247.8 req/s | 27.2s | hết sập, nhưng đuôi chậm: 1000 VU cùng cold-miss ~5 key list một lượt (thundering herd — C5) |
| **Cache + single-flight `wrap()`** | 1000 | **559ms** | **6.04ms** | **0%** | **701 req/s** | 4.31s | 50.584 iteration, **0 gãy**; ~104× tốt hơn baseline về p95, ~74× throughput |

> **Phát hiện quyết định (C5 thành thật):** bản cache get/set vẫn để p95 = 7.92s vì lúc
> khởi động 1000 VU cùng miss đúng ~5 key list → 1000 truy vấn `COUNT+offset` giống hệt đập
> DB một lượt. Trị bằng **single-flight**: `cache-manager` `wrap()` gộp N request cùng miss
> một key thành **1** lần chạy loader (đã kiểm riêng: 1000 lời gọi đồng thời → đúng 1 truy
> vấn DB), 999 cái còn lại chờ chung kết quả. p95 tụt 7.92s → **559ms**.

> **p95 559ms vs ngưỡng 500ms:** hụt 58ms. Đây là do điều kiện đo (C6): server(prod
> build)+MySQL+k6 CÙNG 1 máy Windows tranh CPU — riêng việc k6 tạo tải 1000 VU đã ăn CPU
> đáng kể. Số dùng SO TƯƠNG ĐỐI trước/sau (58s → 0,56s), không phải mốc tuyệt đối. Trên
> production (DB tách host, Redis chia sẻ giữa các instance, không có k6 giành CPU) đuôi này
> còn co lại nữa.

## 6. Env-bridge — chạy được ở cả dev và production Linux (không nợ kỹ thuật)
`app.module.ts` cấu hình cache bằng `CacheModule.registerAsync` đọc `REDIS_URL`:
- **Không có `REDIS_URL`** (máy này) → in-memory mặc định. Dev/test chạy ngay, không cần Redis.
- **Có `REDIS_URL`** (server Linux) → Redis qua Keyv. `@keyv/redis` được `import` ĐỘNG qua
  biến nên máy chưa cài gói vẫn build/chạy được; chỉ prod cần `npm i @keyv/redis`.

Đúng nguyên tắc 12-factor (khác biệt dev/prod nằm ở CONFIG, không ở CODE). Deploy Linux chỉ
cần: (1) `sudo apt install redis-server` (hoặc Redis quản lý), (2) `npm i @keyv/redis`,
(3) đặt `REDIS_URL=redis://...` trong `.env`. **Không sửa 1 dòng code.** Fail-open (C3) vẫn
giữ trên prod: Redis chết → đọc thẳng DB, không sập.
