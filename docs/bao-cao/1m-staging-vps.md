# Đo 1 triệu dòng trên VPS staging thật (02/11/2026)

Nhánh `perf/1m-tong-hop` (f1b3bea) chạy trên staging thật, 1 triệu dòng mỗi
bảng nóng, bắn tải từ máy Windows qua Internet vào
`https://api-staging.zoldify.com`. Đo xong đã trả staging về nguyên trạng.

## Môi trường

| | |
|---|---|
| Máy | VPS 2 vCPU, 3,9 GB RAM, swap 2 GB. Prod và staging **chung máy**, cùng notion-manager, opencode-proxy, warp-svc, 9router, cloudflared |
| Staging | 3 api (trần 512M, heap 384M) + worker (heap 192M) + MySQL 8 (trần 1G, buffer pool 512M, `max_execution_time` 5000) + Redis + `redis-queue` mới, đúng compose của nhánh |
| Dữ liệu | `scripts/seed-1m.sql` trên DB staging: 1.000.010 users, 1.001.173 products, 1.000.010 orders, 1.300.012 order_items, 1.000.047 reviews, 1.000.025 notifications, 50.002 hội thoại, 1.000.008 tin nhắn. 2,4 GB dữ liệu + index (thư mục MySQL 3,0 GB). Đổ mất **411 giây** |
| Bộ đo | Bản chạy-từ-xa của `scripts/loadtest.ts` chế độ `LOADTEST_1M=1`: đúng 12 route, đúng cách xoay tham số, vòng kín, mức 1 / 20 / 50, mỗi lượt 5 giây, làm nóng như bản gốc |
| Mạng | Healthcheck rỗng từ máy đo: p50 **124 ms**, p95 145 ms. Mọi số dưới đây **đã gồm** chặng mạng này |
| Rate limit | Ảnh staging riêng, nâng trần throttler lên 1.000.000 (guard vẫn chạy, vẫn đếm qua Redis), tương đương bản gốc thay kho đếm. Prod không đổi |

Khác bản đo local: server không còn chung máy với bộ tạo tải, có 3 api thay
vì 1, nhưng mỗi request cộng thêm ~124 ms mạng. Ở mức 1, số VPS gần như chỉ là
độ trễ mạng; so sánh có ý nghĩa nằm ở mức 20 và 50.

## p95 theo route (ms), song song 1 / 20 / 50

Local: lần đo "Sau" trong `1m-tong-hop.md` (một api, cùng máy, không có chặng mạng).

| Route | Local | VPS staging | RPS VPS ở mức 50 |
|---|---|---|---:|
| Danh mục | 7 / 67 / 131 | 201 / 284 / 409 | 255 |
| Danh sách SP (xoay trang, 6 kiểu sắp) | 25 / 121 / 224 | 187 / 262 / 362 | 253 |
| Tìm kiếm (10 từ khoá) | 8 / 102 / 140 | 213 / 293 / 360 | 277 |
| SP theo danh mục | 14 / 100 / 165 | 166 / 219 / 342 | 258 |
| Chi tiết SP (id ngẫu nhiên) | 12 / 114 / 258 | 185 / 218 / 525 | 227 |
| Chi tiết SP ~9.950 đánh giá | 5 / 51 / 152 | 154 / 200 / 471 | 239 |
| Đơn bán, người bán nặng | 48 / 425 / 981 | 166 / 376 / 1.085 | 89 |
| Đơn mua, người mua nặng | 41 / 337 / 970 | 165 / 458 / 990 | 87 |
| Chat, người bán nặng | 33 / 539 / 1.048 | 165 / 388 / 646 | 129 |
| Chat, người mua nặng | 31 / 386 / 1.131 | 179 / 423 / 947 | 114 |
| Admin thống kê | 8 / 94 / 202 | 133 / 334 / 211 | 330 |
| Admin thống kê đơn | 5.056* / 167 / 404 | 144 / 215 / 286 | 307 |

**0 lỗi 5xx ở mọi route và mọi mức.** Lỗi 4xx duy nhất là 404 của chi tiết SP
(~4%, hàng nháp/đã bán, đúng luật như local). `performance_schema` ghi 0 câu
lỗi, tức không câu nào chạm trần 5 giây. Bài chèn ngang: healthcheck p50 114 ms
lúc rảnh, 132 ms khi 4 request danh sách SP đang chạy (+18 ms).

Đọc bảng: trừ ~124 ms mạng thì các route danh mục / sản phẩm ở mức 50 còn
~150 đến 400 ms, ngang hoặc nhỉnh hơn local. Đơn hàng và chat ở mức 50 ra
gần bằng local (khoảng 0,65 đến 1,1 giây). Ba api chia tải không bù được hai
vCPU chung cho cả MySQL lẫn prod. (*) Ô 5.056 ms local là lần lấp cache lạnh;
trên VPS lần lạnh rơi vào lượt làm nóng, câu chậm nhất của nó trong log là
953 ms (cộng doanh thu trên 722.526 dòng).

## explain-1m (EXPLAIN_CHI_DO=1, chỉ đo, chạy trong container cạnh MySQL staging)

12/14 câu nóng dưới hoặc bằng 10 ms, đúng index như local (vận đơn tới hạn tự
chốt 10,2 ms, 1.973 dòng đọc). Hai câu "CẦN XEM" vẫn là hai câu viết tay mô
phỏng mà app không còn đi: đơn bán qua `order_shipments` **4.651 ms** (sát trần
5 giây) và hội thoại `OR` hai cột 13 ms.

## Tài nguyên trong lúc đo (mẫu 5 giây, ~3 phút tải)

| | Đỉnh |
|---|---|
| CPU máy | 95% (trung bình 43%), load 7,04 trên 2 vCPU |
| RAM còn dùng được | thấp nhất **446 MB** (lúc rảnh trước đo 634 MB) |
| Swap | cao nhất 1.715 / 2.047 MB (trước khi làm gì đã dùng 1,4 đến 1,7 GB) |
| MySQL staging | **1.009 MiB / trần 1 GiB** suốt từ lúc đổ dữ liệu: cgroup chạm trần và tự đòi lại page cache (`memory.events max` > 13.000 lần), `oom_kill 0` |
| api staging | cao nhất 158 MiB / 512 MiB; worker 75 MiB / 256 MiB; redis-queue 7 MiB |
| OOM, khởi động lại | **không**: RestartCount và OOMKilled của mọi container prod và staging không đổi, dmesg 0 lần "Killed process" |
| Câu chậm (> 0,5 s) | 35 câu, chậm nhất 0,95 s: tổng doanh thu admin (722k dòng), đơn bán đường EXISTS (948 lần, tb 121 ms, max 917 ms), đếm đơn của người mua nặng (909 lần, tb 143 ms), các `COUNT(*) ... deleted_at IS NULL` trên users/products/orders lúc lấp cache admin (tb ~370 ms) |

Lúc build image trên VPS (trước khi đo) swap đầy 2.047 MB và RAM còn dùng được
xuống 629 MB; build xong trở lại bình thường.

## Ảnh hưởng tới prod

Prod chạy liên tục, không bị đụng. Lấy mẫu `GET https://api.zoldify.com/api/v1/categories`:

| Nơi lấy mẫu | Số mẫu | Độ trễ | Lỗi |
|---|---:|---|---:|
| Máy đo (Windows), mỗi 10 s | 20 | p50 352 ms, p95 703 ms | 0 |
| Trên VPS (curl, gồm bắt tay TLS), mỗi 10 s | 18 | tb 513 ms, max 758 ms | 0 |
| Trên VPS lúc không có tải (trước và sau) | | 410 đến 600 ms | 0 |

Không thấy prod chậm đi rõ rệt; container prod không khởi động lại lần nào
(vẫn chạy từ 27/10).

## VPS có gánh được 1 triệu dòng mỗi bảng không

**Gánh được về độ đúng và độ trễ, chưa thoải mái về RAM.**

- Được: 0 lỗi 5xx ở 50 kết nối song song, không câu nào chạm trần 5 s, p95
  dưới ~1,1 giây kể cả các route nặng nhất, các bản vá của nhánh giữ đúng index
  trên máy thật.
- Chưa thoải mái: MySQL staging ngồi đúng trần 1 GiB suốt bài đo, RAM còn dùng
  được của cả máy xuống 446 MB, swap gần đầy ngay cả khi không có tải. Đây là
  một máy chở **hai** cụm. Nếu prod cũng lên 1 triệu dòng với buffer pool 512M
  thì hai MySQL cùng giữ ~2 GB, phần còn lại không đủ cho 6 api + 2 worker +
  các dịch vụ khác. Trước khi prod lớn tới cỡ đó: tách staging sang máy khác
  hoặc nâng RAM.
- CPU: 2 vCPU chạm 95% ở mức 50. Muốn nhiều hơn ~250 đến 300 RPS cho các route
  danh mục / sản phẩm (~90 đến 130 cho đơn hàng và chat) thì cần thêm nhân, không phải thêm bản api.

## Phát hiện ngoài lề: mọi người dùng chung MỘT hạn mức rate limit

`main.ts` đặt `trust proxy 1`, nên `req.ip` lấy từ chặng ngay trước api là
Caddy. `Caddyfile` không khai `trusted_proxies`, nên Caddy bỏ
`X-Forwarded-For` của nginx và ghi IP của nginx (cổng docker). Kết quả: api
thấy mọi người dùng cùng một IP, và throttler 10 request/giây là **10 request/giây
cho cả sàn**.

Đã thử trên staging (sau khi khôi phục, mã gốc a5a2d90): VPS bắn ~20 req/s,
cùng lúc máy Windows chỉ gửi 4 req/s (dưới trần) nhưng nhận **12/12 lần 429**.
Prod nhiều khả năng cùng cấu hình (cũng đi nginx rồi Caddy) nhưng chưa thử trên
prod. Sửa: khai `trusted_proxies private_ranges` (hoặc dải mạng docker) trong
khối `reverse_proxy`/`servers` của Caddy, rồi kiểm lại bằng hai IP như trên.

## Khôi phục

- Sao lưu: `/opt/manual-backups/staging-before-1m-20261102-090041.sql.gz` (lúc
  bắt đầu) và `staging-before-1m-postgate-20261102-091720.sql.gz` (ngay trước
  khi ghi vào DB, dùng bản này để khôi phục).
- Đã làm: dừng api/worker, `DROP DATABASE` + tạo lại (utf8mb4_unicode_ci), nạp
  bản sao lưu, `git checkout staging` (a5a2d90), compose gốc + override cổng
  3100, xoá container và volume `redis-queue`, xoá image tạm.
- Kiểm lại: 27 bảng, users 9, products **1.173** (bằng lúc đầu), orders 10,
  migration cuối `AddOrderConfirmedAt1788400000000`, 3 index mới không còn,
  buffer pool 128M, `max_execution_time` 0, api staging chạy
  `zoldify-backend:latest` (cùng image prod, cùng commit a5a2d90), `GET /` và
  `/api/v1/categories` 200. Đĩa trống trở lại 20 GB.

Lưu ý khi deploy: prod và staging dùng **chung tag** `zoldify-backend:latest`.
Build staging bằng compose là đổi image mà lần `up` kế tiếp của prod sẽ dùng.
Bài đo này build bằng tag riêng để tránh; nên tách tag (vd
`zoldify-backend:staging`) trong compose của staging.
