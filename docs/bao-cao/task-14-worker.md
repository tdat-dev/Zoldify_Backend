# Task #14 — Tách tiến trình worker (BullMQ + cron ra khỏi API)

**Vai:** B — Platform · DevOps · Backend nghiệp vụ
**Hạn theo bảng phân công:** 19/08 → 21/08 · **Làm ngày:** 29/08 (trễ 8 ngày)
**Nhánh:** `feat/task-14-worker` · **Bài kiểm:** `npm run check:worker`

---

## 1. Mục tiêu & bối cảnh

Bảng phân công ghi lý do bằng đúng một câu: *"BullMQ + cron ra khỏi API, nếu
không cron tiền chạy N lần."*

Nói bằng mã thật thì như sau. `TasksService` có hai job `@Cron(EVERY_HOUR)`:

| Job | Việc | Đụng gì |
|---|---|---|
| `autoCancelOrders` | huỷ đơn nằm im quá 48 giờ | hoàn ký quỹ cho người mua, cộng hàng về kho |
| `settleDeliveredShipments` | chốt vận đơn đã giao | **giải ngân ký quỹ cho người bán** |

Cả hai hẹn giờ bằng `@nestjs/schedule`, tức bộ đếm giờ nằm **trong chính tiến
trình API**. `TasksModule` được `AppModule` nạp, nên mỗi bản `api` dựng lên là
một bộ đếm giờ nữa. Ba bản api = tới 10 giờ có ba lượt huỷ đơn chạy song song.

Và mã **không chống được** chuyện đó. `OrdersService.cancelExpired`
(`orders.service.ts:1111`) đọc đơn rồi `assertCancellable` **ngoài**
transaction, không khoá dòng; chỉ `applyCancellation` mới vào transaction. Hai
tiến trình cùng đọc thấy `PENDING` thì cả hai cùng qua cửa, cùng gọi
`escrowsService.refund` và cùng `em.increment(Product, stock)`.

**Hôm nay lỗi chưa nổ** vì `docker-compose.yml` dựng đúng một bản `api`. Nó là
mìn chờ — và Epic 4 (cache Redis) với task #5 (socket, throttler qua Redis) tồn
tại chính là để nâng số bản api lên. Ngày làm điều đó là ngày mìn nổ, ở chỗ
không ai nhìn: không request nào lỗi, chỉ có sổ tiền lệch.

---

## 2. Pre-mortem — rủi ro dự đoán (TRƯỚC khi sửa)

| # | Mức | Rủi ro | Cách chặn |
|---|-----|--------|-----------|
| **R1** | **CAO** | Thêm worker mà **quên gỡ** `@Cron` khỏi API → cron chạy ở **cả hai**, tức nhân đôi thay vì sửa. | Bài kiểm quét `src/` tìm `@Cron/@Interval/@Timeout`; FAIL nếu còn. Gỡ luôn gói `@nestjs/schedule` để không viết lại được. |
| **R2** | **CAO** | Ngược lại: cron **không chạy ở đâu cả**. Tệ hơn R1 vì nó im lặng — đơn quá hạn không ai huỷ, tiền ký quỹ nằm im, không request nào lỗi. | Worker in lịch **đọc ngược từ Redis** chứ không in lại hằng số vừa gửi. Bài kiểm đăng ký lịch thật rồi `getJobSchedulers()` đếm lại. |
| **R3** | **CAO** | BullMQ `queue.add(..., { repeat })` khoá bản ghi theo **nội dung** lịch → đổi biểu thức cron là **đẻ bản ghi mới, giữ bản cũ**. Ra đúng con bệnh đang đi chữa, qua một lần sửa lịch tưởng vô hại. | Dùng `upsertJobScheduler` (khoá theo id). Bài kiểm gọi hai lần với hai pattern rồi đếm bản ghi. |
| **R4** | **CAO** | Nhiều worker cùng chạy một lượt quét → vẫn hoàn tiền hai lần (vì R-gốc: thiếu khoá dòng). | `concurrency: 1`; compose chỉ khai **một** bản worker, ghi rõ lý do ngay trong file. |
| **R5** | TB | Redis chết → worker "chạy tiếp" mà không có hàng đợi = tiến trình sống nhăn không làm gì. | Worker **không fail-open** (ngoại lệ duy nhất của repo): ném lỗi, `process.exit(1)`, để Docker dựng lại. |
| **R6** | TB | `Dockerfile` khai `HEALTHCHECK` gọi HTTP; worker không mở cổng → container `unhealthy` vĩnh viễn, mọi thứ đọc trạng thái đó đọc sai. | `healthcheck: disable: true` cho service worker. Bài kiểm canh. |
| **R7** | TB | Worker chạy trước khi migration xong → job đụng bảng chưa có. | `depends_on: migrate: service_completed_successfully`. |
| **R8** | TB | Worker xin `connectionLimit` bằng api → chạm trần `max_connections=151` của MySQL. | Worker để **5**, không 50. Lý do ghi ngay tại chỗ. |
| **R9** | THẤP | `bullmq` 6 để `ioredis` thành peer **optional** với khoảng `>=5.0.0` — lời hứa viết trước khi ioredis 6 tồn tại. | Chốt `bullmq@^5.81.4` (5.x vẫn phát hành đều, phụ thuộc `ioredis ^5.3.2` tường minh) + khai `ioredis` tường minh. |

---

## 3. Test viết TRƯỚC (đỏ → xanh)

`scripts/selfcheck-worker.ts` — viết và **commit trước khi có dòng mã nào**
(`db31266`), chạy ngay thì đỏ vì ba module trong `src/ops/jobs/` chưa tồn tại.

Bài kiểm hỏi hai câu, câu thứ hai mới là câu khó:

1. **Phần tĩnh** — cron đã ra khỏi API chưa. Đọc mã, không cần hạ tầng.
2. **Phần động** — ra rồi thì có còn chạy **đúng một lần** không. Dựng **hai
   worker thật** trên **Redis thật**, đẩy một job, đếm số lần thực thi.

Không có Redis thì **FAIL chứ không SKIP**: một bài kiểm tự tắt khi thiếu hạ
tầng là bài kiểm luôn xanh.

### Thử đột biến — chứng minh bài kiểm không rỗng

Test xanh ngay lần đầu là thứ không nên tin. Đã cố tình gây lỗi để xem nó có kêu:

| Đột biến | Kết quả |
|---|---|
| Dùng `repeat` kiểu cũ rồi đổi lịch một lần | **2 bản ghi lịch** → mục "không nhân bản" **BẮT ĐƯỢC** |
| Đẩy hai job (mô phỏng hai bộ hẹn giờ) | bộ đếm = **2** → mục "đúng 1 lần" **BẮT ĐƯỢC** |
| `TEST_DB_PORT` sai | mục "WorkerModule dựng được" **FAIL** kèm `ECONNREFUSED 127.0.0.1:3399` |

---

## 4. Đã làm

14 commit nhỏ, mỗi commit một việc.

| Việc | File |
|---|---|
| Bài kiểm viết trước (27 mục) | `scripts/selfcheck-worker.ts` |
| Hằng số, lịch, bộ xử lý, runner | `src/ops/jobs/*.ts` |
| Điểm vào worker + module gốc riêng | `src/worker.ts`, `src/worker.module.ts` |
| Gỡ `@Cron` + `ScheduleModule` | `src/ops/tasks/tasks.*.ts`, `src/app.module.ts` |
| Gỡ gói `@nestjs/schedule` | `package.json` |
| Service `worker` | `docker-compose.yml` |
| Service redis + cổng `check:worker` | `.github/workflows/ci.yml` |

### Ba quyết định đáng ghi lại

**`upsertJobScheduler` chứ không `repeat`.** Lý do đầy đủ ở R3. Đây là loại lỗi
lẻn vào qua một lần sửa tưởng vô hại, và mã sau đó vẫn trông như "một job một
lịch".

**Lịch đổi từ phút 0 sang phút 7 và 23.** Phút 0 là lúc đông nhất trên máy chủ:
cron `mysqldump` (task #24), log rotate, và mọi thứ khác người ta hẹn giờ. Trước
đây hai job này cũng cùng nổ ở phút 0 — đọc GHN và quét bảng `orders` chen nhau
trong cùng một giây.

**Worker không fail-open.** Cả repo fail-open và đó là lựa chọn đúng ở nơi có
người dùng đang chờ. Worker ngược lại: hỏng câm là kiểu hỏng tệ nhất với việc
chạy nền. Chết to tiếng để `restart: unless-stopped` dựng lại.

---

## 5. Hai lỗi thật tìm ra khi chạy, không phải khi đọc

### 5.1 Worker không boot được — bài kiểm 26/26 xanh mà tiến trình chết

```
Nest can't resolve dependencies of the ProductsService
(…, ?). Make sure "CACHE_MANAGER" at index [4] is available in ProductsModule.
```

`JobsModule → TasksModule → OrdersModule → ProductsModule`, và `ProductsService`
`@Inject(CACHE_MANAGER)`. `AppModule` cấp qua `CacheModule`; `WorkerModule` thì
không.

**Điều đáng nói không phải lỗi, mà là lỗ hổng của chính bài kiểm.** 26 mục xanh
hết. Mọi mục tĩnh đều hỏi những câu *đọc mã là trả lời được* — file có tồn tại
không, có nạp `AppModule` không, compose có khai service không. Không câu nào
hỏi câu quan trọng nhất: **"dựng lên có sống không"**. Đã thêm mục thứ 27 dựng
`WorkerModule` thật.

### 5.2 API trên `staging` đang sập khi có `REDIS_URL` — lỗi CÓ SẴN

Tái dựng đúng khối `useFactory` của `staging` ra file riêng và chạy, nó sập y hệt:

```
TypeError: Cannot read properties of undefined (reading 'includes')
    at Keyv._checkIterableAdapter (keyv/dist/index.cjs:488)
    at cachingFactory (@nestjs/cache-manager/dist/cache.providers.js:35)
```

Nghĩa là **`node dist/main` không khởi động được bất cứ khi nào `REDIS_URL` có
giá trị** — mà `docker-compose.yml` đặt `REDIS_URL: redis://redis:6379` cho
chính service `api`. Cache Redis của Epic 4/5 không những không chạy: nó làm api
không boot nổi trong cụm compose.

**Nguyên nhân — dual-package hazard, không liên quan gì tới Redis:**

- Mã biên dịch ra CommonJS, nên `require('keyv')` mà `@nestjs/cache-manager`
  dùng lấy bản `keyv/dist/index.**cjs**`.
- `await import(pkg)` **luôn đi đường ESM**, nên `@keyv/redis` nạp theo đường đó
  lại kéo bản `keyv/dist/index.**js**`.
- Hai bản là hai **lớp khác nhau** trong bộ nhớ. Đo bằng tay:

  ```
  k instanceof keyv(CJS).default = false
  k instanceof keyv(ESM).default = true
  keyv CJS === keyv ESM ?          false
  ```

- `createKeyv()` trả về một `Keyv` (ESM). cache-manager kiểm
  `store instanceof Keyv` (CJS) → false → tưởng đây là store thô và **bọc thêm
  một lớp `Keyv` nữa**. Keyv bên trong không có `.opts.dialect`, câu `.includes`
  nổ.

**Sửa:** `require(pkg)` thay `await import(pkg)`. Với `pkg` là **biến** thì TS
vẫn không resolve tĩnh (giữ được tính optional của gói), mà cả hai cùng đi đường
CJS nên `instanceof` đúng trở lại.

**Nghiệm thu:** `node dist/main` và `node dist/worker` đều khởi động được với
`REDIS_URL` trỏ vào Redis thật.

---

## 6. Kết quả từng cổng (chạy cục bộ)

| Cổng | Lệnh | Kết quả |
|---|---|---|
| Nợ lint (bánh cóc) | `npm run lint:check` | **979** / mốc 979 — đã siết từ 980 |
| Ranh giới nghiệp vụ | `npm run boundaries:check` | **28** / mốc 28 |
| Build | `npm run build` | OK |
| Hợp đồng API | `npm run openapi:check` | OK, không lệch |
| Test | `npm test` | **52/52** — 8 suite |
| Hợp đồng CI | `npm run check:ci` | TẤT CẢ PASS |
| **Worker** | `npm run check:worker` | **27/27 PASS** |

Nghiệm thu chạy thật, không chỉ qua bài kiểm:

```
[JobsRunner] Lịch: chot-van-don    — 23 * * * * — kế tiếp 2026-08-29T16:23:00.000Z
[JobsRunner] Lịch: huy-don-qua-han —  7 * * * * — kế tiếp 2026-08-29T16:07:00.000Z
[JobsRunner] Worker sẵn sàng trên hàng đợi "zoldify-jobs" (2 lịch).
[worker]     Worker đã khởi động. Cron KHÔNG còn chạy trong tiến trình API.
```

---

## 7. Giới hạn (nói thẳng)

**Chưa sửa gốc của "hoàn tiền hai lần".** BullMQ đảm bảo mỗi lượt hẹn giờ chỉ
giao cho một worker, nên nguyên nhân trực tiếp đã hết. Nhưng
`OrdersService.cancelExpired` **vẫn** đọc đơn ngoài transaction và không khoá
dòng — hai lượt quét chồng lên nhau vẫn có cửa. Cố tình **không** sửa trong PR
này: đó là mã tiền của vai A, và task #21 (escrow giải ngân qua ledger) đang
động vào đúng những dòng đó. Trộn một thay đổi khoá dòng vào PR hạ tầng là cách
tạo xung đột và làm review khó. **Đã báo riêng cho trưởng nhóm.**

**Chưa chạy thử bằng `docker compose up` đầy đủ.** Đã chạy `node dist/worker`
thật với MySQL và Redis thật, nhưng chưa dựng cả cụm năm service. Việc đó nên
làm cùng task #6 (thêm `caddy` + `mem_limit`), vì lúc đó mới đụng lại compose.

**Chưa có healthcheck thật cho worker.** Đang `disable: true`. "Worker khoẻ"
nghĩa là "job vẫn tới giờ là chạy" — muốn kiểm thì phải hỏi Redis xem lượt chạy
gần nhất cách đây bao lâu. Đó là việc của giám sát, chưa có trong phạm vi #14.

**Chỉ chạy MỘT bản worker.** An toàn về số lần chạy thì nhiều bản cũng được,
nhưng vì lý do ở đoạn đầu mục 7 nên chưa nâng. Hai job mỗi giờ thì một bản là đủ.

---

## 8. Ảnh hưởng tới các PR đang mở

`package.json`, `scripts/selfcheck-all.ts` và `.github/workflows/ci.yml` đều là
file mà PR #13/#14/#15 cùng đụng (thêm dòng vào mảng `suites`, thêm khối
`check:*`, thêm bước CI). Xung đột sẽ nhỏ và cùng loại.

Khối `services.redis` trong `ci.yml` cố ý viết **giống hệt** khối của PR #15
(cùng `redis:7`, cùng cổng `6380`) để lúc merge chỉ cần giữ một bản.

Ai merge sau thì gỡ. Đề nghị thứ tự: **#12 → #13 → #14 → #15 → #16 (PR này)**.
