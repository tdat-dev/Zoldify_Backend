# Lệnh sửa B5 — vòng 3, từng bước

**Gửi:** OpenCode · **Người ra lệnh:** vai B (Cường) · **Ngày:** 06/10/2026
**Nền:** `b5da37a` (HEAD hiện tại, không ai reset gì)
**Đọc kèm:** phần B của `huong-dan-va-viec-con-lai-M01.md`, và `lenh-sua-B5.md` (vòng 2)

---

## Trước khi bắt đầu — hai điều cần biết

**Việc 1 và 2a bạn làm đúng.** `npm run build` từ 62 lỗi về **EXIT 0**. Mock
`flushViewCount` trong `selfcheck-worker.ts` và thêm vào interface `CongViecNen`
là chọn đúng (sửa interface, không `as any`). `Promise.allSettled` ở ca đua
`follows` đúng ý. Những chỗ đó **giữ nguyên**, đừng sửa lại.

**Còn 10 bước dưới đây.** Làm **đúng thứ tự** — bước 1 mở đường cho mọi đo đạc
sau, vì hiện tại `npm test` không chạy xong nên không ai đo được gì.

Số tôi đo lúc 06/10, trên đúng cây làm việc của bạn:

```
npm run build          EXIT 0   ✓
npm test               EXIT 1   ← tiến trình Node bị GIẾT giữa đường, không in ra dòng "Test Suites:"
npm run lint:check     EXIT 1   ← Nợ lint: 934 (903 lỗi + 31 cảnh báo), mốc 910, +24 mới
npm run openapi:check  EXIT 1
npm run check:compose  EXIT 0   ✓
npm run check:boot     EXIT 1   ← CÓ SẴN, không phải lỗi của bạn (xem bước 10)
```

Hai con số trong `B5_COMPLETION_REPORT.md` cần sửa lại cho đúng:
mốc lint là **910**, không phải 966 (966 là mốc từ tháng trước). Và
`check-lint.mjs` đếm **lỗi + cảnh báo** = 934, nên 903 "errors" một mình không
phải con số cổng dùng. Lần sau chạy `npm run lint:check`, đừng chạy `npx eslint`
tay — chạy tay thì bỏ qua bánh cóc.

---

# Bước 1 — một dòng import, và nó đang chặn mọi thứ

**Vấn đề.** `src/catalog/shop/shop.service.spec.ts:187` dùng `ForbiddenException`
nhưng dòng 1 chỉ import hai thứ:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
```

Chuỗi hậu quả, theo đúng thứ tự máy chạy:

1. `service.getSellerOrders(...)` được gọi **trước** → trả promise đã bị từ chối
2. `.rejects.toThrow(ForbiddenException)` — đánh giá tham số → `ReferenceError`
3. Nên **không ai gắn handler** vào promise bị từ chối ở bước 1
4. Node 22 giết tiến trình vì unhandled rejection

Tôi chạy riêng file đó để chắc chắn:

```
npx jest src/catalog/shop/shop.service.spec.ts
→ [ForbiddenException: Bạn không có quyền xem đơn hàng này]
  Node.js v22.16.0
  EXIT=1
```

Vì `jest.config.js` đặt `maxWorkers: 1` (chạy tuần tự, có lý do — đọc comment ở
đó), tiến trình chết ở giữa và **không dòng `Test Suites:` nào được in**. Tám
suite trong báo cáo là tám suite kịp xong trước lúc sập. Repo có **36 file
`.spec.ts`**.

**Sửa:**

```ts
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
```

**Vì sao `npm run build` không bắt được:** `tsconfig.build.json` loại
`**/*spec.ts`. File bài kiểm chưa bao giờ được kiểm kiểu bởi build. Ghi nhớ:
**build xanh không có nghĩa là spec biên dịch được.**

**Nghiệm thu:**
```bash
npx jest src/catalog/shop/shop.service.spec.ts; echo "EXIT=$?"   # EXIT=0
```

**Commit:** `fix(test): thieu import ForbiddenException lam ca bo test chet giua duong`

---

# Bước 2 — bỏ hai câu `throw` làm app không dựng được

**Vấn đề.** `products.service.ts:72-75` và `tasks.service.ts:42-45`:

```ts
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL is required for ProductsService');
}
```

Ném trong constructor → DI chết → `NestFactory.create(AppModule)` chết. Nghĩa là
**thiếu Redis thì app không khởi động nổi.**

Lệnh vòng 2, việc 2b nói rõ điều ngược lại: *api có thể không có Redis — đếm là
việc tốt-thì-có, không có Redis thì bỏ đếm, tuyệt đối không được làm route hỏng.*

Và nó trái kiến trúc repo đã ghi ở `src/common/cache.config.ts:63-67`:

> *REDIS_URL có nhưng KHÔNG nạp được @keyv/redis … **KHÔNG chặn boot**: rơi về
> in-memory + cảnh báo. Fail-open ngay từ lúc khởi động.*

**Sửa:** `this.redis` thành **tuỳ chọn**.

```ts
private readonly redis: Redis | null = null;
```

Trong constructor: không có `REDIS_URL` thì `logger.warn` một dòng rồi để
`this.redis` là `null`. **Không ném.**

Giữ nguyên `enableOfflineQueue: false`, `maxRetriesPerRequest: 1` và
`on('error')` — ba thứ đó bạn làm đúng, và comment ở `app.module.ts:82-99` kể vì
sao thiếu listener `error` là **giết cả tiến trình Node**.

**Nghiệm thu:** đây là **ca đối chứng**, bắt buộc phải làm và ghi lại:

```bash
npm run build; echo "EXIT=$?"                    # EXIT=0
# chạy check:boot KHÔNG có REDIS_URL — app phải dựng được
REDIS_URL= npm run check:boot 2>&1 | head -8
```

Mục `NestFactory.create(AppModule)` phải **PASS**.

**Commit:** `fix(view-count): thieu Redis thi bo dem, khong duoc chan boot`

---

# Bước 3 — gỡ bản vá đặt vào spec của Đạt

**Vấn đề.** `src/ordering/orders/dat-hang-va-ton-kho.spec.ts:73-76`:

```ts
// ProductsService yêu cầu REDIS_URL để tạo client Redis cho view_count (INCR).
// Test không load .env tự động, phải set thủ công.
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
```

Ba vấn đề:

1. Nó **vá triệu chứng** của bước 2, không vá nguyên nhân. Sau bước 2 thì không
   cần nữa.
2. Nó sửa **spec của Đạt** (`src/ordering/`) — đây là phần đơn hàng, không phải
   phần của ta.
3. URL đó **không có Redis**: `.env` ghi cổng 6379, còn container
   `zoldify-test-redis` map **6380**. Kiểm: `docker port zoldify-test-redis`.

**Sửa:** xoá cả bốn dòng đó, trả file về nguyên trạng:

```bash
git checkout -- src/ordering/orders/dat-hang-va-ton-kho.spec.ts
```

**Nghiệm thu:**
```bash
npx jest src/ordering/orders/dat-hang-va-ton-kho.spec.ts; echo "EXIT=$?"   # EXIT=0
git status --short src/ordering/   # phải RỖNG
```

**Commit:** gộp vào commit của bước 2 cũng được, vì cùng một lý do.

---

# Bước 4 — `try/catch` quanh `incr`, nếu không route vẫn 500

**Vấn đề.** `products.service.ts:524`:

```ts
await this.redis.incr(viewCountKey);   // không có try/catch
```

Và comment ngay trên `on('error')` viết: *"Fail-open: Redis error is logged but
doesn't crash the app"*. **Câu đó không đúng.** Tôi đo bằng đúng tuỳ chọn và
đúng listener mà file này đang dùng:

```
KET QUA: incr NEM loi -> Stream isn't writeable and enableOfflineQueue options is false
listener on(error) da bat 0 loi ket noi — nhung KHONG chan duoc loi nem nay
```

`on('error')` chỉ bắt **sự kiện kết nối**. Một lệnh bị từ chối là **promise
rejection riêng** — `await` nó là ném. Với `enableOfflineQueue: false`, Redis mất
nghĩa là `GET /products/:id` trả **500**, không phải fail-open.

**Sửa:** bọc `try/catch`, nuốt lỗi, ghi log có tiết chế. Và vì bước 2 cho
`this.redis` được `null`, nhớ kiểm `null` trước.

Comment viết lại cho **khớp mã** và kể đúng cái bẫy: *`on('error')` bắt sự kiện
kết nối, không bắt lệnh bị từ chối — đo được thông báo "Stream isn't writeable"
khi Redis mất.*

**Cùng việc với `flushViewCount`** trong `tasks.service.ts`: hàm này **không có
`try/catch`**, trong khi `autoCancelOrders` và `settleDeliveredShipments` ngay
trên nó đều bọc và `logger.error`. Một lượt flush lỗi không được phép làm chết
cả lượt chạy của worker. Làm giống hai hàm kia.

**Nghiệm thu:** ca đối chứng thứ hai, bắt buộc ghi lại:

```bash
# Redis KHÔNG với tới được (đúng tình trạng hiện tại: .env 6379 vs container 6380)
npm run check:boot 2>&1 | grep -E "products|PASS|FAIL"
```

`GET /api/v1/products/:id` phải **200**, không phải 500.

**Commit:** `fix(view-count): on('error') khong bat duoc lenh bi tu choi — boc try/catch`

---

# Bước 5 — đếm trước khi kiểm cache

**Vấn đề.** `products.service.ts:485-524` — việc 2c của vòng 2, **chưa làm**:

```ts
const cached = await this.cacheGet<Product>(key);
if (cached) return cached;        // ← trả về sớm
...
await this.redis.incr(viewCountKey);   // ← không chạy khi cache trúng
```

`PRODUCT_DETAIL_TTL = 60_000`. Nên trong mỗi 60 giây chỉ **lượt xem đầu tiên**
được đếm. `view_count` thấp hơn thực tế hàng chục lần — mà `findAll` có
`sort=most_viewed` và `sort=featured` xếp theo đúng cột này, nên số sai làm sai
luôn thứ tự trang chủ.

**Sửa:** chuyển khối `incr` lên **trước** `const cached = ...`.

**Nghiệm thu:** `npm run build; echo "EXIT=$?"` → `EXIT=0`, và đọc lại mã để
chắc `incr` nằm trên dòng `if (cached) return cached;`.

**Commit:** `fix(view-count): dem truoc khi kiem cache — TTL 60s lam mat gan het luot xem`

---

# Bước 6 — `getSellerOrders`: bắt buộc tham số `user`

**Vấn đề.** `shop.service.ts:130-142` — việc 4 của vòng 2, **chưa làm**:

```ts
async getSellerOrders(sellerId, page, limit, status?, user?: { id: number; role: string }) {
  // Check này ở SERVICE chứ không ở controller: đảm bảo bất biến an toàn
  // dù service được gọi từ bất kỳ đâu (controller, script, job, test).
  if (user && user.role !== 'admin' && user.id !== sellerId) {
```

`user` **tuỳ chọn** và guard chỉ chạy `if (user)`. Gọi
`getSellerOrders(5, 1, 20)` không truyền `user` thì đi qua sạch. Chính cái đường
gọi *"từ bất kỳ đâu"* mà comment nói tới là đường **không bị chặn**.

Đây là mặc định **fail-open** của một kiểm tra quyền. Tệ vì nó im lặng: không
log, không lỗi, chỉ là dữ liệu của người khác chảy ra.

**Sửa:**

```ts
user: IUser,        // bắt buộc, không dấu ?
...
if (user.role !== 'admin' && user.id !== sellerId) {
```

`IUser` **đã được import** ở `shop.service.ts:19`, không cần thêm import.

Và **viết lại comment cho khớp mã** — bỏ câu hứa sai, nói đúng cái nó làm.

**Nghiệm thu:**
```bash
npm run build; echo "EXIT=$?"      # EXIT=0 — tsc là thứ bắt chỗ gọi thiếu
npx jest src/catalog/shop/shop.service.spec.ts; echo "EXIT=$?"   # EXIT=0
```

**Ca đối chứng:** bỏ guard đi → ca *"người lạ … bị ForbiddenException"* phải
**ĐỎ** → trả guard lại → **XANH**. Ghi lại cả hai lượt.

**Commit:** `fix(shop): bat buoc tham so user — guard dang mac dinh MO`

---

# Bước 7 — lưu đúng refresh token vừa phát hành

**Vấn đề.** `auth.service.ts:302-303` — việc 5 của vòng 2, **chưa làm**:

```ts
const newRefreshToken = this.createRefreshToken(newPayload);          // trả cho client
await this.usersService.updateUserToken(
  this.jwtService.sign({ sub: user.id, token_version: user.token_version }),  // ← lưu CÁI KHÁC
  user.id.toString());
```

Cái được lưu vào cột `refresh_token` ký bằng **secret access**, payload khác, và
không phải token vừa phát hành. So với `login()` ở dòng 88-89 lưu đúng
`refreshToken`.

Hiện chưa ai đọc cột đó để đối chiếu nên chưa thành lỗ bảo mật — nhưng nó là
**dữ liệu sai nằm im**, và mọi logic thu hồi theo cột đó về sau sẽ sai.

**Sửa:**

```ts
await this.usersService.updateUserToken(newRefreshToken, user.id.toString());
```

**Phần còn lại của B5-3 giữ nguyên** — route `@Public()`, throttle 5/s, DTO,
kiểm `token_version`, và `logout()` có `increment(..., 'token_version', 1)` nên
chống dùng lại sau đăng xuất là **thật**. Chỗ đó làm đúng.

**Commit:** `fix(auth): luu dung refresh token vua phat hanh vao DB`

---

# Bước 8 — viết lại comment tự mâu thuẫn ở `follows.service.spec.ts`

**Vấn đề.** Nửa sau của việc 3 vòng 2, **chưa làm**. 20 dòng đầu file giải thích:

```
 * VÌ SAO DÙNG REPOSITORY GIẢ Ở ĐÂY, TRONG KHI `wallets` DÙNG MySQL THẬT.
 ...
 * [CẬP NHẬT]: Khoá UNIQUE(follower_id, following_id) ĐÃ CÓ trong migration
 * InitialSchema (line 70). Bài kiểm này chuyển sang dùng MySQL thật …
```

File **đang dùng MySQL thật**, nên 20 dòng đầu nói sai, và đoạn `[CẬP NHẬT]`
dán thêm nói ngược lại. Comment tự mâu thuẫn tệ hơn không có comment: người đọc
sau không biết tin dòng nào.

**Sửa:** viết lại **một** lý do, khớp mã. Nội dung nên có:

- Bất biến thật nằm ở **database** (khoá `UNIQUE(follower_id, following_id)`),
  nên bài kiểm phải chạy trên MySQL thật — mock đi thì xanh mà không chứng minh gì.
- Khoá đó **đã có sẵn** ở `src/migrations/1690000000000-InitialSchema.ts:70` và
  `@Unique` trong `follow.entity.ts`. B5-2 **không có việc sửa mã** — chỉ có
  việc viết bài kiểm. Nói thẳng như vậy.
- Ca đua dùng `Promise.allSettled`: hai `toggle` **song song**, đúng một
  `rejected`, đúng một `fulfilled`, và sau đó bảng còn **một** dòng. Giải thích
  vì sao gọi tuần tự thì không kiểm được gì (lần hai `toggle` **xoá** dòng rồi
  trả về, nó không ném).

Điểm cuối là bài học đáng giữ nhất của vòng này — viết nó vào comment để người
sau không lặp lại.

**Commit:** `docs(test): viet lai ly do o follows.spec cho khop ma`

---

# Bước 9 — hạ nợ lint về mốc

```
Nợ lint: 934 (903 lỗi + 31 cảnh báo) — mốc cho phép: 910
Có 24 vấn đề lint MỚI so với mốc.
```

Tệ hơn lúc tôi ra lệnh vòng 2 (926). Phần lớn là **prettier**, tức sửa tự động
được. Tôi đếm trên các file bạn đổi:

| File | tổng | trong đó prettier |
|---|---|---|
| `tasks.service.ts` | 10 | **9** |
| `auth.service.ts` | 26 | **4** |
| `follows.service.spec.ts` | 3 | **2** |
| `shop.service.spec.ts` | 2 | **1** |
| `jobs.processor.ts` | 1 | **1** |

**Sửa:**

```bash
npx eslint --fix src/catalog/products/products.service.ts \
  src/ops/tasks/tasks.service.ts src/ops/jobs/jobs.processor.ts \
  src/catalog/shop/shop.service.ts src/catalog/shop/shop.service.spec.ts \
  src/identity/auth/auth.service.ts src/identity/auth/auth.controller.ts \
  src/catalog/follows/follows.service.spec.ts scripts/selfcheck-worker.ts
```

Còn lại thì sửa tay. Một chỗ cụ thể: `products.service.ts:80` có
`on('error', (err) => {` nhưng thân hàm chỉ có comment — `err` không dùng tới,
`no-unused-vars` bắt. Sau bước 4 thì nó sẽ được dùng để ghi log, nên lỗi này tự
hết.

**Không nâng `BASELINE`.** Bánh cóc chỉ đi xuống. Nếu đo được **thấp hơn** 910
thì hạ `BASELINE` xuống **đúng số đo được** và nói số đó trong thông điệp commit.

**Nghiệm thu:** `npm run lint:check; echo "EXIT=$?"` → `EXIT=0`.

**Commit:** `style: ha no lint 934 -> <=910`

---

# Bước 10 — sinh lại `openapi.json`, dọn, rồi commit

### 10a. `openapi.json`

`openapi:check` = `openapi:gen && git diff --exit-code openapi.json`, tức nó so
cây làm việc với **index** — nó hỏi *"file đã vào git chưa"*. B5-3 thêm
`RefreshTokenDto` nên lược đồ đổi.

```bash
npm run openapi:gen
git add openapi.json
npm run openapi:check; echo "EXIT=$?"      # EXIT=0
```

### 10b. Xoá `test_output.txt`

Bản dump UTF-16 của một lượt chạy PowerShell, còn nằm trong cây từ vòng trước.

### 10c. `check:boot` — KHÔNG phải việc của bạn

`npm run check:boot` đỏ với `TypeError: fetch failed`. Tôi đã kiểm: gác thay đổi
của bạn đi rồi chạy lại trên cây đã commit `b5da37a` → **cũng EXIT 1**. Vậy lỗi
này **có sẵn**, không do B5.

Nguyên nhân: `.env:61` ghi `REDIS_URL=redis://127.0.0.1:6379` nhưng container
map **6380** (`docker port zoldify-test-redis`). **Đừng sửa `.env` theo ý mình** —
ghi nó vào báo cáo như một phát hiện riêng, để tôi quyết sửa cổng nào.

Sau bước 2 và 4 thì `check:boot` có thể tự xanh trở lại (vì app sẽ chịu được
không-Redis). Nếu nó xanh, nói rõ là xanh; nếu vẫn đỏ, dán **nguyên văn** lỗi và
**đừng đoán nguyên nhân**.

---

## Commit như thế nào

Mười bước trên là **ít nhất 8 commit riêng**, không gộp. `git log` phải kể được
thứ tự suy nghĩ. Thông điệp tiếng Việt không dấu, giải thích **vì sao**, kèm
**số đo**.

**Cây làm việc đang lẫn việc của hai người.** `git commit` không có đường dẫn thì
commit **toàn bộ index**, không chỉ thứ vừa `add`. Commit bằng đường dẫn tường
minh, và sau mỗi commit chạy `git show --stat HEAD` để xem mình vừa commit cái
gì. Tôi đã dính đúng bẫy này — xem mục A4 của bản hướng dẫn.

Hiện **chưa có gì được commit**: HEAD vẫn `b5da37a`, toàn bộ việc B5 nằm trong
cây làm việc. Đó là lý do cả hai báo cáo trước không kiểm lại được.

---

## Nghiệm thu cuối — dán đúng những dòng này

```bash
git status --short                                   # phải SẠCH
npm run build;            echo "build EXIT=$?"
npm run lint:check;       echo "lint EXIT=$?"
npm run openapi:check;    echo "openapi EXIT=$?"
npm run check:boot;       echo "boot EXIT=$?"
npm run check:audit;      echo "audit EXIT=$?"
npm run check:compose;    echo "compose EXIT=$?"
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root \
TEST_DB_PASSWORD=testpw TEST_DB_NAME=zoldify_test npm test; echo "test EXIT=$?"
```

Với `npm test`, dán thêm **ba dòng tổng kết của jest**:

```
Test Suites: ... passed, ... total
Tests:       ... passed, ... total
```

Lần này con số `total` phải khớp với **36 file spec** của repo. Nếu nó in ra 8
suite thì tiến trình lại chết giữa đường — đó là tín hiệu, không phải kết quả.

Quy tắc duy nhất tôi muốn giữ: **không có dòng `EXIT=0` thì không được đánh ✅.**
Cổng nào còn đỏ thì viết thẳng là còn đỏ, dán nguyên văn lỗi, và **đừng đoán
nguyên nhân**.

---

## Không tự quyết

| Không | Vì sao |
|---|---|
| Nâng `BASELINE` lint | bánh cóc chỉ đi xuống |
| Sửa `.env` | cấu hình máy thật, tôi quyết (xem 10c) |
| Sửa file trong `src/ordering/` hay `src/money/` | vai A (Đạt) giữ. Viết bài kiểm thì được, sửa mã thì không |
| `git push` | push `staging` là deploy ngay ra `api-staging.zoldify.com` |
| `rm -rf .git`, `git init` lại, `git reset --hard`, `git gc --prune` | lịch sử cục bộ đã mất một lần hôm 05/10 và **không phục hồi được** — cả hai bản chụp VSS đều hỏng, và không nhánh nào của ta từng được push |
| Xoá tài liệu cũ | giữ vết, đánh dấu lỗi thời thay vì xoá |
