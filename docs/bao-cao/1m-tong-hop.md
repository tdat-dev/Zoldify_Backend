# Đợt 1 triệu dòng: báo cáo tổng hợp (nhánh perf/1m-tong-hop)

Ngày đo: 02/11/2026. Nhánh `perf/1m-tong-hop` gộp 4 nhánh (fix/1m-duong-sap,
perf/1m-index-cau-hinh, perf/1m-truy-van, feat/anh-nhe-webp) trên
`origin/staging` a5a2d90, cộng các bản vá tìm ra khi đo thật ở cỡ 1 triệu dòng.
Chưa push, chưa deploy.

## Môi trường đo

| | |
|---|---|
| Database | `zoldify_1mall`: `migration:run` + `npm run seed` + `scripts/seed-1m.sql` (1.000.000 users, 1.001.015 products, 1.000.003 orders, 1,3 triệu order_items, 1 triệu reviews, notifications, messages; 50.000 hội thoại) |
| MySQL | 8.4 trong WSL docker (`zoldify-test-mysql`), buffer pool 512M, `max_execution_time` 5000 (đặt GLOBAL cho giống compose) |
| Redis | bật (`LOADTEST_REDIS=1`, DB số 7 riêng) |
| Bộ đo | `LOADTEST_1M=1 npm run loadtest`: 12 route, mức song song 1 / 20 / 50, mỗi lượt 5 giây, tham số xoay theo request (trang, từ khoá, danh mục, id sản phẩm) để không trúng mãi một khoá cache; tài khoản "nặng" của seed (người bán 100000: 10.000 sản phẩm, ~20.000 đơn, 5.000 hội thoại; người mua 105000: ~2.000 đơn, 2.000 hội thoại) |
| Máy | server và bộ tạo tải cùng một máy Windows, một tiến trình api |

Bản đầy đủ: `docs/system-design/load-test-1m-truoc.md` (trước) và
`docs/system-design/load-test-1m.md` (sau).

## p95 theo route (ms), song song 1 / 20 / 50

"Trước" là lần đo đầu trên HEAD 88e2e28 (đã có các bản vá 28/10 của nhánh).
"Sau" là lần đo cuối trên HEAD hiện tại.

| Route | Trước | Sau | Ghi chú |
|---|---|---|---|
| Danh mục `GET /categories` | 5 / 32 / 53 | 7 / 67 / 131 | cache 60 s, không đổi mã |
| Danh sách SP (xoay trang, 6 kiểu sắp) | 27 / 58 / 144 | 25 / 121 / 224 | không đổi mã |
| **Tìm kiếm** (xoay 10 từ khoá) | **4.586 / 12.912 / 52.485, 60 lần 5xx** | **8 / 102 / 140, 0 lỗi** | sửa |
| SP theo danh mục | 7 / 70 / 205 | 14 / 100 / 165 | không đổi mã |
| Chi tiết SP (id ngẫu nhiên) | 13 / 101 / 208 | 12 / 114 / 258 | ~6% là 404 đúng luật (hàng nháp/đã bán) |
| Chi tiết SP ~9.950 đánh giá | 5 / 38 / 65 | 5 / 51 / 152 | |
| **Đơn bán của người bán nặng** | **5.467 / 11.005 / 12.020, 21 lần 5xx** | **48 / 425 / 981, 0 lỗi** | sửa |
| Đơn mua của người mua nặng | 29 / 255 / 607 | 41 / 337 / 970 | không đổi mã |
| **Chat: hội thoại người bán nặng** | **2.055 / 5.450 / 8.975** | **33 / 539 / 1.048** | sửa (lần đo trước đó: 26 / 281 / 626) |
| **Chat: hội thoại người mua nặng** | **847 / 5.358 / 8.797** | **31 / 386 / 1.131** | sửa (lần đo trước đó: 23 / 253 / 610) |
| Admin: thống kê | 7 / 71 / 134 | 8 / 94 / 202 | cache 60 s |
| Admin: thống kê đơn | 7 / 76 / 186 | 5.056* / 167 / 404 | *một request lấp cache lúc lạnh, xem rủi ro |

Không còn 5xx ở bất kỳ route nào, không crash, không OOM. Ở mức 50, CPU của
MỘT tiến trình Node chạm ~100% ở gần như mọi route (cột `cpu` trong file kết
quả), nên p95 tăng theo hàng đợi của chính Node chứ không phải MySQL: đó là
giới hạn của một tiến trình, production chạy 3 bản api. Ở mức 20, mọi route
dưới ~500 ms; chat người bán dao động 281 đến 539 ms giữa hai lần đo do máy đo
dùng chung.

## Đã sửa trong đợt này (ngoài các commit 28/10 đã có)

1. **Danh sách hội thoại** (`ChatService.getMyConversations`). `findAndCount`
   với `buyer_id = ? OR seller_id = ?` qua ba LEFT JOIN, bọc bảng con
   `distinctAlias`: quét cả bảng hội thoại, 1.172 ms mỗi câu, 153.508 dòng.
   Nay một câu UNION ALL hai nhánh trên `idx_buyer_updated` /
   `idx_seller_updated`, một câu đếm hai COUNT, nạp quan hệ theo id: 1,5 ms.
   Khoá phụ `id DESC` khi trùng giây. Bài kiểm:
   `chat-danh-sach-hoi-thoai.spec.ts`.
2. **Đơn của người bán** (`OrdersService.findAll` nhánh `as=seller`).
   - Migration `AddSellerOrderIndexesFor1M1788700000000`: index phủ products
     (seller_id, deleted_at), order_items (product_id, order_id), orders (id,
     deleted_at, status, created_at); `USE INDEX` cho orders vì optimizer vẫn
     chọn PRIMARY. Câu JOIN lạnh 7.123 ms xuống 934 ms.
   - Đếm có trần (`demCoTran`) và nhớ 60 giây theo (người bán, trạng thái).
   - Người bán nhiều đơn: đi từ đơn mới nhất xuống bằng `EXISTS` (gợi ý
     `NO_SEMIJOIN`) khi ước lượng số đơn phải đọc không quá 20.000; trang đầu
     21 ms. Trang sâu và người bán ít đơn giữ câu JOIN.
   Bài kiểm: `don-nguoi-ban-1m.spec.ts`, `check:index` (3 mục mới).
3. **Tìm kiếm** (`ProductsService.queryProductList` nhánh `q`).
   - Từ dài bắt buộc đủ (`+từ*`): trước là HOẶC, "sneaker cao cấp" khớp gần
     nửa bảng (3.976 ms xuống 895 ms) và "tai nghe" ra cả "Tai lợn".
   - Thứ tự mặc định/newest: thử cửa sổ 20.000 món đang bán mới nhất trước
     (cùng cách của từ ngắn), trang không đầy mới đi FULLTEXT cả bảng. Từ phổ
     biến như "giày" (83.401 món khớp) từ 2.049 ms ấm, hơn 5 s lạnh xuống vài
     chục ms.
   Bài kiểm: `tim-kiem-nhieu-tu.spec.ts`, `tim-kiem-cua-so.spec.ts`.
4. **Công cụ đo**: `LOADTEST_1M=1` cho `scripts/loadtest.ts`;
   `EXPLAIN_CHI_DO=1` cho `scripts/explain-1m.ts` (đo trên dữ liệu có sẵn,
   không TRUNCATE). Kết quả trên zoldify_1mall: 12/14 câu nóng dưới 10 ms.
   Hai câu "CẦN XEM" là câu viết tay mô phỏng đơn bán (qua order_shipments)
   và hội thoại (OR hai cột) của người bán nặng; app không còn đi hai dạng đó
   sau mục 1 và 2. Lần chạy lại ngay sau loadtest + nghiệm thu, câu "vận đơn
   tới hạn tự chốt" (job tự xác nhận của worker) chạm trần 5 s một lần: đo
   tay lạnh 1.047 ms, ấm 20 ms (989 vận đơn, đúng index), xem rủi ro.

## Còn rủi ro

- **Tìm kiếm có đánh đổi.** Từ phổ biến ở thứ tự mặc định chỉ hiện hàng trong
  20.000 món mới nhất, chỉ khớp tên, và `meta.total` đếm trong cửa sổ. Sắp theo
  giá / bán chạy / xem nhiều với từ phổ biến vẫn đi FULLTEXT cả bảng: 1 đến 2
  giây khi ấm, có thể quá trần 5 s khi lạnh (trả 500, và vì không ghi được
  cache nên lần sau lại chậm). Gỡ hẳn: chỉ mục tìm kiếm riêng (bảng hẹp tên +
  trạng thái + created_at với FULLTEXT ngram, hoặc máy tìm kiếm ngoài).
- **Thống kê admin lấp cache lúc lạnh.** `orders.getStats` cộng doanh thu trên
  ~780.000 mục index; lần lấp cache đầu sau khi MySQL khởi động lại mất tới
  ~5 s (đo được 5.056 ms, sát trần 5 s). Cache 60 s nên chỉ một request chịu,
  nhưng nếu quá trần thì route trả 500 cho tới khi một lần chạy kịp. Gỡ: bảng
  tổng hợp cập nhật theo sự kiện, hoặc job làm ấm sau khởi động.
- **Đơn của người bán, trang sâu.** Trang sâu của người bán nặng vẫn đi câu
  JOIN (165 ms ấm, gần 1 s lạnh mỗi trang). Gỡ: cột/bảng (đơn, người bán) ghi
  lúc đặt hàng.
- **Đọc lạnh sau khi buffer pool bị xả.** Ngay sau loadtest + nghiệm thu, câu
  tìm vận đơn tới hạn của job tự xác nhận (đúng index, 989 dòng) có một lần
  quá 5 s trong explain-1m; đo tay lạnh 1.047 ms, ấm 20 ms. Trần
  max_execution_time là cấu hình server nên áp cả cho worker: job lặp lại ở
  lượt sau, nhưng nên theo dõi log câu chậm của worker sau deploy.
- **Một tiến trình Node bão hoà CPU từ ~20 kết nối.** Đúng như bài đo cũ: muốn
  hơn phải thêm bản api, không phải thêm nhân.
- **Bộ dữ liệu là dữ liệu sinh.** Phân bố của seed-1m (đều, id tăng theo thời
  gian) có thể khác dữ liệu thật; đường "đi từ đơn xuống" dựa vào ước lượng
  MAX(id) / tổng đơn của người bán.
- Bài `danh-sach-hai-buoc.spec.ts` (không đổi) có lúc đỏ trên database test đã
  qua nhiều suite khác (optimizer chọn Sort trên bảng 3.600 dòng); xanh trên
  `zoldify_test` sạch. Không liên quan mã của đợt này.

## Ghi chú deploy

**Migration mới** (chạy theo thứ tự, đều online `ALGORITHM=INPLACE, LOCK=NONE`,
chờ khoá tối đa 10 s, chạy lại được):

1. `1788500000000-AddHotListIndexesFor1M` (index danh sách nóng, gỡ index thừa)
2. `1788600000000-AddDeletedAtIndexesFor1M` (deleted_at vào index đếm/thống kê)
3. `1788700000000-AddSellerOrderIndexesFor1M` (3 index phủ cho đơn của người
   bán; ~18 s trên 1 triệu dòng mỗi bảng, prod nhỏ hơn nhiều)

Sao lưu trước khi chạy như mọi lần deploy có migration.

**docker-compose.yml:**

- MySQL: `--innodb-buffer-pool-size=${MYSQL_BUFFER_POOL:-512M}` (trần container
  1G; đổi `MYSQL_MEM` thì đổi số này theo) và
  `--max-execution-time=${MYSQL_MAX_EXECUTION_MS:-5000}` (chỉ cắt SELECT;
  `scripts/backup-db.sh` tự đặt `max_execution_time=0` cho phiên dump).
- Service mới `redis-queue` (redis:7, `noeviction`, AOF everysec, maxmemory
  64mb, mem_limit 96m, volume `redis-queue-data`). api và worker có
  `QUEUE_REDIS_URL: redis://redis-queue:6379`; BullMQ đọc biến này, chưa đặt
  thì rơi về `REDIS_URL`. Cache và throttler vẫn ở `redis`.
- Heap: api `NODE_OPTIONS=--max-old-space-size=${API_HEAP_MB:-384}`, worker
  `--max-old-space-size=${WORKER_HEAP_MB:-192}`.
- Worker có lịch dọn thông báo cũ mỗi đêm 3:41 (đã đọc > 90 ngày, mọi thứ >
  180 ngày) trên hàng đợi chính.

**Phụ thuộc:** nhánh ảnh nhẹ (webp) thêm gói vào `package-lock.json`; build
image mới, không dùng lại node_modules cũ.

**Sau deploy nên kiểm:** `docker compose ps` thấy `redis-queue` healthy; log
worker đăng ký lịch; `SELECT @@innodb_buffer_pool_size, @@max_execution_time`;
smoke các route ở bảng trên.

## Nghiệm thu

`npm run nghiem-thu` trên HEAD 14d4cc9 (commit 52c5124 ghi `nghiem-thu.md`):
**17 cổng PASS, `check:core` BỎ QUA** (cần zoldify_bulk_test ≥ 500k đơn,
ngoài phạm vi). Chạy với DB `zoldify_1m_gate` (migration:run + seed), jest
trên `zoldify_test`, Redis DB 7. `npm test` 128 suite / 796 bài xanh; lint
nợ 464 (mốc 519, trước đợt 458). `check:index` 35 mục, `check:drift` không
lệch.

Lượt đầu có hai cổng đỏ, không cái nào do mã sản phẩm: (1) bài mới
`don-nguoi-ban-1m.spec.ts` dựa vào MAX(id) của DB test dùng chung, đã sửa bài
(14d4cc9); (2) `check:backup` gọi `bash` từ PowerShell ra bash của WSL, dọn
file không ăn; đặt Git bash lên đầu PATH thì xanh.

Bài kiểm mới chạy riêng trên DB `zoldify_1mall_t`: chat 50/50, đơn hàng +
chat + sản phẩm 298/301 (2 đỏ là `danh-sach-hai-buoc.spec.ts` không đổi, ghi
ở phần rủi ro).
