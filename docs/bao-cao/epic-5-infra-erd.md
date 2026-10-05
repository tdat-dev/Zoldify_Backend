# Báo cáo Epic 5 — Hạ tầng (Redis vào compose) + ERD + tổng kết 6 Epic

**Người thực hiện:** Cường · **Ngày:** 2026-08-23 · **Nhánh:** `feat/epic-5-infra-erd` → PR vào `staging`
**Trạng thái:** XONG (test-first; đo tổng thể sau tối ưu; ghi rõ giới hạn không có Docker cục bộ)

## 1. Mục tiêu & bối cảnh
Epic 5 là chốt cuối: hoàn thiện hạ tầng cho mục tiêu 1000 user + vẽ/kiểm sơ đồ CSDL (ERD).
Khi vào việc mới thấy **phần lớn artifact đã có sẵn** (Dockerfile, docker-compose.yml, ERD
sinh bằng script `erDiagram()`, cả bộ sơ đồ C4). Việc thật của Epic 5 là **phản ánh hiện
thực mới mà Epic 4 vừa tạo ra**: Redis từ "planned" thành "thật".

## 2. Pre-mortem — Rủi ro & lỗi ẩn dự đoán (TRƯỚC khi sửa)
| # | Mức | Rủi ro | Cách chặn |
|---|-----|--------|-----------|
| E1 | **CAO** | Thêm Redis vào compose (đặt `REDIS_URL`) nhưng image thiếu `@keyv/redis` → factory `app.module` ném lỗi **lúc BOOT** → app không khởi động. | (a) `@keyv/redis` vào **dependencies** (image `npm ci --omit=dev` có sẵn); (b) bọc factory **try/catch** → thiếu gói/lỗi tạo store thì rơi về in-memory + cảnh báo, KHÔNG chặn boot. |
| E2 | TB | Redis vào compose nhưng cache là "phụ trợ" — nếu coi bắt buộc, Redis down làm sập. | Fail-open có sẵn từ Epic 4 (C3) — Redis chết thì đọc thẳng DB. Redis cache tắt ghi đĩa (`--save '' --appendonly no`): mất cache không sao. |
| E3 | TB | Sơ đồ **nói dối**: vẽ Redis "đã có đủ cache/throttle/socket/queue" trong khi chỉ cache là thật. | Sửa nhãn + ghi chú ĐÚNG mức: cache = CÓ; throttle/socket/queue = CHƯA (vẫn in-process). |
| E4 | TB | ERD lỗi thời so với schema sau 4 Epic. | Regenerate ERD từ script → **diff = rỗng** (byte-identical) ⇒ schema không đổi (Epic 1–4 chỉ đụng index + cache, không đụng bảng/cột/FK). |
| E5 | **CAO (đo)** | Không có Docker cục bộ → KHÔNG chạy `docker compose up` để nghiệm thu được. | Nói THẲNG trong báo cáo; validate compose bằng parser YAML + kiểm wiring; đánh dấu "config-verified, chưa brought-up". |

## 3. Test trước (đỏ→xanh / kiểm được)
- **Boot resilience (E1):** factory `CacheModule.registerAsync` bọc try/catch — có `REDIS_URL`
  mà lỗi Redis vẫn rơi về in-memory, app vẫn lên.
- **ERD current (E4):** `node scripts/make-drawio.mjs --force 10-entity` rồi `git diff` →
  **không đổi** ⇒ ERD vẫn khớp 25 bảng/khoá ngoại hiện tại.
- **Compose hợp lệ (E5):** parse YAML → 4 service `mysql, redis, migrate, api`; `api` có
  `REDIS_URL=redis://redis:6379`, `depends_on: {migrate: completed, redis: healthy}`.
- **`npm run drawio:check`:** 20 file .drawio hợp lệ, 0 lỗi.
- **`npm run check`:** cả 3 suite (Epic 0/1/2, 3, 4) vẫn PASS sau mọi thay đổi.

## 4. Đã làm
- **`docker-compose.yml`:** thêm service `redis:7` (thuần RAM, healthcheck `redis-cli ping`);
  `api` nhận `REDIS_URL=redis://redis:6379` + `depends_on` redis healthy; sửa ghi chú đầu
  file (trước "KHÔNG có Redis" → nay giải thích vì sao giờ CÓ).
- **`package.json`:** thêm `@keyv/redis ^5.1.6` vào dependencies (đường Redis cần client này;
  image runtime có sẵn). `package-lock.json` cập nhật kèm (đã được duyệt commit cho thay đổi này).
- **`.env.sample`:** thêm section Cache/Redis + `REDIS_URL=` (trống = in-memory); bump "25→26 biến".
- **`src/app.module.ts`:** factory cache bọc try/catch (E1) — boot không bao giờ chết vì Redis.
- **Sơ đồ:** `r2-container.drawio` (bản C4 trung thực) đổi hộp Redis từ đỏ "(planned)" →
  "cache: CÓ (Epic 4) · throttle/socket/queue: CHƯA", và cập nhật ghi chú (kèm caveat "compose
  có Redis nhưng CHƯA brought-up vì máy không Docker"). ERD regenerate xác nhận không đổi.

## 5. Đo tổng thể sau tối ưu (k6 1000 VU, nhánh tích hợp Epic 5)
| Mốc | p95 | median | http_req_failed | throughput | iterations |
|-----|-----|--------|-----------------|-----------|-----------|
| **Baseline (Epic 0, chưa tối ưu)** | ~58s | (sập) | 16.6% | 9.5 req/s | — |
| **Sau toàn bộ tối ưu (Epic 1–4 + tích hợp)** | **~0,56–0,67s** | **6–9ms** | **0%** | **~700 req/s** | 50k+/0 gãy |

Từ *sập hệ thống* thành *0% lỗi, ~700 req/s, median ~9ms* — **~100× tốt hơn** về p95. p95 dao
động 559–669ms giữa các lần do đo **cùng một máy** (server+MySQL+k6 tranh CPU — pre-mortem C6);
số dùng SO TƯƠNG ĐỐI. Trên production (Redis chia sẻ giữa các instance, DB tách host, không k6
giành CPU) đuôi này còn co lại.

## 6. Giới hạn (nói thẳng)
- **Không chạy `docker compose up` được** trên máy này (không có Docker) → phần Redis trong
  compose là **config-verified** (YAML + wiring + boot-resilience), CHƯA nghiệm thu bằng cách
  dựng cụm thật. Người deploy có Docker chỉ cần `npm run docker:up` để kiểm.
- Đo tải dùng cache **in-memory** (không có Redis cục bộ). Đường mã giống hệt production; khác
  biệt là cache dùng chung giữa nhiều instance — chỉ thấy được khi chạy nhiều bản sau Caddy.

## 7. Tổng kết 6 Epic (mục tiêu đề bài: ≥1M bản ghi, 1000 user)
| Epic | Kết quả | Bằng chứng |
|------|---------|-----------|
| 0 | Seed 1M sạch (0 mồ côi/34 FK, ledger cân) | `selfcheck.ts` |
| 1 | orders.findAll 240s→1.1s; chặn `?limit=1tr` | PR #2, `selfcheck.ts` |
| 2 | Keyset trang sâu O(1), không phá API | PR #3/#4, `selfcheck.ts` |
| 3 | Chặn limit toàn hệ + index ghép (hết filesort) + dọn index thừa | PR #5/#6/#8, `selfcheck-indexes.ts` |
| 4 | Cache catalog (env-bridge + single-flight + fail-open): p95 58s→0,56s, lỗi 16,6%→0% | PR #7, `selfcheck-cache.ts` |
| 5 | Redis vào compose + ERD xác nhận khớp + đo tổng thể | PR này |

**Nghiệm thu 1 lệnh:** `npm run check` (cả 3 suite PASS) · `k6 run -e TARGET_VU=1000 loadtest/catalog-load.js`.
