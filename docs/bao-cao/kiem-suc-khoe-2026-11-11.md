# Kiểm sức khoẻ cụm Backend — 11/11/2026

> **Kết luận:** lúc mọi dịch vụ đều sống thì cụm **KHOẺ**: 37/37 ca qua.
> Nhưng chỉ cần **Redis chết** thì cụm **HỎNG**: mọi route có chạm cache treo
> vô thời hạn, và Docker đánh dấu cả 3 bản api là unhealthy. Lỗi này ngược với
> thiết kế ghi trong `src/ops/health/health.service.ts`. Mục 4 có số đo và
> nguyên nhân.

| | |
|---|---|
| Bộ kiểm | `scripts/selfcheck-suc-khoe.ts` |
| Lệnh | `npm run check:suc-khoe` (đo cụm ở xa: `SUC_KHOE_URL=https://… npm run check:suc-khoe`) |
| Nhánh · commit | `test/kiem-suc-khoe` · `dc07144` |
| Đích | `http://localhost:8080` — Caddy → `api` ×3 → MySQL + Redis của cụm compose |
| Dữ liệu | 1015 sản phẩm, 9 danh mục |

## 1. Vì sao cần bộ kiểm này

Mọi suite trong `npm run check` đều tự dựng app ngay trong tiến trình của nó
(`NestFactory.create`) hoặc chỉ đọc file cấu hình. **Không suite nào hỏi cụm
đang chạy**, tức là chưa suite nào cho request đi qua Caddy, tới một trong ba
bản api, rồi xuống MySQL/Redis thật của cụm. Bộ kiểm này là hộp đen: nó chỉ gọi
HTTP và đọc `docker inspect`, không import mã nào của ứng dụng.

Bộ kiểm cần cụm đang chạy, nên **chưa** được thêm vào `npm run check` và CI.

## 2. Pre-mortem

| # | Rủi ro | Cách chặn |
|---|---|---|
| R1 | Throttler (10/1s · 50/10s · 300/60s) đếm chung qua Redis, mà mọi request của bài kiểm đều từ một IP, nên bài kiểm có thể tự dính 429 và báo đỏ giả | Giãn mỗi request cách nhau 300 ms (33 request/10 s, dưới trần 50); bài bắn tải dồn dập đặt **cuối cùng** |
| R2 | Caddy dùng `least_conn`. Request đi tuần tự thì cả 3 bản đều 0 kết nối, Caddy chọn ngẫu nhiên, nên ca "đủ 3 bản" có thể chập chờn | Lấy 20 mẫu: xác suất sót một bản ≈ 3·(2/3)²⁰ ≈ 0,09 % |
| R3 | `/health` trả `redis: "off"` (vẫn 200) khi thiếu `REDIS_URL` | Trong cụm compose, `off` nghĩa là đấu thiếu dây, nên tính là **FAIL** |
| R4 | Bài hộp đen không có "mã để sửa", nên không tự nhiên có lượt đỏ | Nghiệm thu bằng **tiêm lỗi** (mục 4) |
| R5 | Máy không có Docker, hoặc đo cụm ở xa | Nhóm A ghi **BỎ QUA**, không tính là xanh |
| R6 | Database rỗng | Lời nhắn ghi rõ "thiếu dữ liệu" để không ai đi sửa mã |

## 3. Test case và kết quả

Có hai cột kết quả:

- **Bình thường**: chạy lúc 18:43, commit `dc07144`, mã thoát 0.
- **Redis chết**: lượt tiêm lỗi ở mục 4, chạy bằng commit `6533c46`.

### A. Container của cụm (`docker inspect`)

| ID | Ca kiểm | Kỳ vọng | Bình thường | Redis chết |
|---|---|---|---|---|
| A1 | Các bản api | 3/3 running + healthy | ✅ 3/3 | ✅ |
| A2 | Lịch sử container | `RestartCount = 0`, không `OOMKilled` | ✅ | ✅ |
| A3 | mysql | running + healthy | ✅ | ✅ |
| A3 | redis | running + healthy | ✅ | ❌ exited (đúng như chủ ý) |
| A4 | worker, caddy | running | ✅ ✅ | ✅ ✅ |
| A5 | migrate | đã thoát, mã 0 | ✅ | ✅ |

### B. Sống và khoẻ

| ID | Ca kiểm | Kỳ vọng | Bình thường | Redis chết |
|---|---|---|---|---|
| B1 | `GET /` | 200 | ✅ 200 | ✅ 200 |
| B2 | `GET /health` | 200 | ✅ 200 | ❌ **treo, timeout 5 s** |
| B3 | `/health` → `status` | `ok` | ✅ ok | ❌ không có phản hồi |
| B4 | `/health` → `db` | `up` | ✅ up | ❌ không có phản hồi |
| B5 | `/health` → `redis` | `up` (`off` cũng tính là hỏng) | ✅ up | ❌ (thiết kế muốn ở đây `down` kèm mã 200) |
| B6 | `/health` không bị bọc phong bì `{statusCode,data}` | Docker đọc được mã HTTP thật | ✅ | ❌ |

### C. Cân tải qua Caddy

| ID | Ca kiểm | Kỳ vọng | Bình thường | Redis chết |
|---|---|---|---|---|
| C1 | 20 × `/health`, đếm tiền tố khác nhau trong `X-Request-Id` | 3 tiền tố (3 tiến trình) | ✅ 3/3 (`c35fda35`, `8b83ba6b`, `bf24dc03`) | ❌ không request nào trả lời |
| C2 | 20 lượt đó đều 200 | 20/20 | ✅ 20/20 | ❌ 0/20 |

### D. API đọc công khai

| ID | Ca kiểm | Kỳ vọng | Bình thường | Redis chết |
|---|---|---|---|---|
| D1 | `GET /api/v1/products?pageSize=5` | 200, có mảng `result` | ✅ | ❌ treo |
| D2 | `meta.total` | > 0 | ✅ 1015 | ❌ |
| D3 | `pageSize=100000` | bị chặn ≤ 100 | ✅ 100 | ❌ treo |
| D4 | `GET /products/{id đầu tiên}` | 200, đúng id | ✅ id 1015 | ⊘ bỏ qua (không có id để mở) |
| D5 | `GET /products/999999999` | 404, không phải 500 | ✅ 404 | ❌ treo |
| D6 | `GET /api/v1/categories` | 200, có danh mục | ✅ 9 | ✅ |

### E. Lỗi phải thành 4xx, không thành 5xx

| ID | Ca kiểm | Kỳ vọng | Bình thường | Redis chết |
|---|---|---|---|---|
| E1 | Route không tồn tại | 404 JSON | ✅ 404 | ✅ |
| E2 | `/orders` không có token | 401 | ✅ 401 | ✅ |
| E3 | `/orders` với token rác | 401 | ✅ 401 | ✅ |
| E4 | `POST /auth/login` với body JSON hỏng | 400 | ✅ 400 | ✅ |
| E5 | `POST /auth/login` với body `{}` | 4xx | ✅ 401 | ✅ |

### F. Header và bề mặt lộ ra ngoài

| ID | Ca kiểm | Kỳ vọng | Bình thường | Redis chết |
|---|---|---|---|---|
| F1 | `X-Content-Type-Options` | `nosniff` | ✅ | ✅ |
| F2 | `X-Frame-Options` | có | ✅ SAMEORIGIN | ✅ |
| F3 | `X-Powered-By` | không lộ | ✅ | ✅ |
| F4 | `X-Request-Id` hợp lệ do client gửi | trả lại nguyên vẹn | ✅ | ❌ treo |
| F5 | `X-Request-Id: "}{"level":"fatal` (dạng chèn dòng log giả) | bị thay bằng mã hợp lệ | ✅ `8b83ba6b-5k` | ❌ treo |
| F6 | CORS với `Origin: https://ke-gian.example` | không có `Access-Control-Allow-Origin` cho origin đó | ✅ không có header | ✅ |
| F7 | `/api/docs` gọi từ xa qua Caddy | 404 hoặc 401 | ✅ 404 | ✅ |

### G. Độ trễ (qua Caddy, gọi tuần tự, không tải)

| ID | Ca kiểm | Ngưỡng | Bình thường | Redis chết |
|---|---|---|---|---|
| G1 | p95 `/health`, 20 mẫu | < 100 ms | ✅ 6,6 ms | ❌ 5014,6 ms (chạm timeout) |
| G2 | p95 `/products`, 10 mẫu | < 500 ms | ✅ 17,8 ms | ❌ 5012,4 ms (chạm timeout) |

Ngưỡng đặt rộng có chủ ý. Đây là câu hỏi "còn khoẻ không", không phải bài đo
tải; đo tải đã có `npm run loadtest`.

### H. Throttler đếm chung qua Redis

| ID | Ca kiểm | Kỳ vọng | Bình thường | Redis chết |
|---|---|---|---|---|
| H1 | Bắn 24 × `/categories` cùng lúc | không có 5xx hay rớt kết nối | ✅ 0 | ❌ 5 |
| H2 | Số request lọt và số bị 429 | lọt ≤ 10 (trần chung 10/s) | ✅ lọt 10, 429 là 14 | ❌ lọt 19, 429 là 0 |

H2 phân biệt được hai cách đếm. Nếu đếm chung, chỉ 10 request lọt. Nếu mỗi bản
đếm riêng, 24 request chia cho 3 bản ≈ 8 mỗi bản, đều dưới trần 10, nên gần như
không request nào bị 429.

### Tổng

| Lượt | PASS | FAIL | BỎ QUA | Kết luận |
|---|---|---|---|---|
| Bình thường | 37 | 0 | 0 | **KHOẺ** |
| Redis chết | 18 | 18 | 1 | **HỎNG** |
| Sau khi bật lại Redis | 37 | 0 | 0 | **KHOẺ**, cụm tự hồi phục |

## 4. Tiêm lỗi: dừng Redis của cụm

**Cách làm:** `docker stop zoldify_backend-redis-1`, chạy bộ kiểm, rồi
`docker start` lại.

**Dự đoán trước khi chạy:** chỉ A3-redis, B5 và H2 đỏ. Theo thiết kế, khi Redis
chết thì cache và throttler vẫn để request đi qua (fail-open): API chậm hơn
nhưng vẫn phục vụ.

**Thực tế:** đỏ 18 ca, nhiều hơn hẳn dự đoán. Tôi đo tiếp trong lúc Redis chết
lâu hơn, với `curl -m 20`:

```
t=0s    /health=000 20.0s   /products=000 20.0s   /=200 0.005s
t=46s   /health=000 20.0s   /products=000 20.0s   /=200 0.005s
t=92s   /health=000 20.0s   /products=000 20.0s   /=200 0.006s
t=139s  /health=000 20.0s   /products=000 20.0s   /=200 0.007s
t=185s  /health=000 20.0s   /products=000 20.0s   /=200 0.006s
t=231s  /health=000 20.0s   /products=000 20.0s   /=200 0.005s
```

- Request **không chậm đi mà treo hẳn**, suốt gần 4 phút Redis chết. Chỉ
  `GET /`, route không chạm cache, còn trả lời được.
- Healthcheck của Docker ghi `Health check exceeded timeout (5s)` 4 lần liên
  tiếp, và **cả 3 bản api chuyển sang unhealthy**. Đây chính là điều
  `health.service.ts` ghi là phải tránh: "Để Redis giết container là tự tay làm
  hỏng thứ đang còn chạy được."
- Throttler cũng thôi chặn: 19/24 request lọt, 0 request bị 429.

**Nguyên nhân** (đọc từ mã, chưa sửa):

- `src/catalog/products/products.service.ts:301` và
  `src/identity/auth/auth.service.ts:136` bọc lệnh cache trong `try/catch` để
  vẫn phục vụ khi cache lỗi. Nhưng `catch` chỉ chạy khi lệnh **ném lỗi**.
- `src/common/cache.config.ts:61` tạo store bằng `createKeyv(url)` mà không
  truyền tuỳ chọn nào. Khi mất kết nối, client Redis xếp lệnh vào hàng đợi để
  chờ kết nối lại. Promise vì thế không ném lỗi mà **không bao giờ kết thúc**.
- `HealthService.kiemRedis()` (`src/ops/health/health.service.ts:93`) `await`
  cache mà không đặt trần thời gian, nên `/health` treo theo.

Đăng nhập (`auth.service`) nhiều khả năng cũng treo theo, nhưng chưa đo trực
tiếp.

**Bộ kiểm cũng có lỗi, đã sửa ở `dc07144`:** khi `/health` treo, B4 lại gợi ý
"API không đọc được MySQL", trong khi MySQL vẫn sống. Giờ khi không có phản hồi,
B2 báo **TREO** và chỉ thẳng sang cache.

## 5. Việc tiếp theo

| Việc | Ghi chú |
|---|---|
| Sửa lỗi treo khi Redis chết | Vai B (cache, health). Bài kiểm đỏ đã có sẵn: dừng Redis rồi chạy `check:suc-khoe`. Hướng sửa: truyền tuỳ chọn cho `createKeyv` để lệnh ném lỗi ngay khi mất kết nối (bản đang cài có `throwOnConnectError`, `disableOfflineQueue`, `connectionTimeout`), và đặt trần thời gian cho `kiemRedis()`. Nghiệm thu: lượt "Redis chết" chỉ còn A3-redis và B5 đỏ, và B5 phải đọc được `redis = down` kèm mã 200 |
| Kiểm đăng nhập lúc Redis chết | Thêm một ca gọi `POST /auth/login` trong lượt tiêm lỗi |
| Throttler lúc Redis chết | Theo thiết kế, H2 đỏ khi Redis chết là chấp nhận được (fail-open). Cần quyết rõ đây là chủ ý, rồi ghi lại |
| Đưa vào quy trình | Chạy `check:suc-khoe` sau mỗi lần `docker:up` hoặc deploy. Có thể thêm vào `nghiem-thu`, kèm điều kiện "cụm đang chạy" |
