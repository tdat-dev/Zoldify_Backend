# Lệnh sửa B5 — vòng 2

**Gửi:** OpenCode · **Người ra lệnh:** vai B (Cường) · **Ngày:** 06/10/2026
**Nền:** `c94c663` · **Quy ước làm việc:** đọc phần B của
`huong-dan-va-viec-con-lai-M01.md` trước khi gõ dòng đầu tiên.

---

## Tình trạng đo được, không phải nhận định

`B5-done-report.md` ghi `build ✅`, `openapi:check ✅`, `lint ✅ 910/910`.
Tôi chạy lại ba cổng đó — **cả ba đỏ**, và không cổng nào cần Docker:

```
npm run build          EXIT 1    62 lỗi TypeScript
npm run openapi:check  EXIT 1    (nó chạy `nest build` trước)
npm run lint:check     EXIT 1    Nợ lint: 926 (895 lỗi + 31 cảnh báo) — mốc 910, thêm 16 lỗi MỚI
```

Nên câu *"Chỉ cần bật Docker → npm test xanh 243/243"* không đúng: mã chưa qua
`tsc` thì không bài kiểm nào chạy được, có Docker hay không.

Dưới đây là 7 việc, **làm đúng thứ tự** — việc 1 mở đường cho mọi việc sau.

---

## Việc 1 — dấu đóng comment trong chuỗi cron làm vỡ cả file

Gốc của 61 trong 62 lỗi. `src/ops/tasks/tasks.service.ts:137`

```
/**
 * Chạy mỗi 5 phút (pattern '<dấu hoa thị><gạch chéo>5 * * * *'). Redis key: ...
   (hai ký tự trong ngoặc nhọn ở trên, viết liền nhau, chính là dấu ĐÓNG khối comment)
```

Chuỗi cron `*` rồi `/` **kết thúc khối comment ngay tại đó**. Phần chữ còn lại bị
đọc như mã nguồn → TS1002 chuỗi chưa đóng, TS1005, TS1128, 21 lỗi TS2304 "không
tìm thấy tên". 60 trong 62 lỗi nằm ở file này.

Và vì cấu trúc class vỡ, `flushViewCount` không còn là thành viên của class —
đó là lỗi thứ 62:

```
src/ops/jobs/jobs.processor.ts:37 — Property 'flushViewCount' does not exist on type 'CongViecNen'
```

**Sửa:** viết pattern sao cho trong khối comment không còn chuỗi đóng đó. Viết
`mỗi 5 phút` bằng chữ, hoặc chèn gạch chéo ngược, hoặc chuyển khối sang `//`.

**Nghiệm thu:** `npm run build; echo "EXIT=$?"` phải còn **đúng 2 lỗi** (hai lỗi
`.store` ở việc 2), không phải 62.

---

## Việc 2 — B5-4 `view_count`: sai API cache, và đếm sai chỗ

### 2a. `cacheManager.store` không tồn tại

```ts
// products.service.ts:508
await this.cacheManager.store.incr(viewCountKey);
```

tsc đã nói thẳng: `Property 'store' does not exist on type 'Cache'. Did you mean 'stores'?`

Tôi đo trên đúng phiên bản repo đang dùng (`cache-manager@7.2.8`):

```
cac khoa cua Cache: get, mget, ttl, set, mset, del, mdel, clear, wrap, on, off, disconnect, cacheId, stores
c.store = undefined
```

`.store` bị bỏ từ cache-manager v5. Dòng đó ném `TypeError` →
**`GET /products/:id` trả HTTP 500 mỗi lần cache miss**, mà
`PRODUCT_DETAIL_TTL = 60_000` nên cứ 60 giây miss một lần. Đây là route công
khai được gọi nhiều nhất của sàn.

Cùng lỗi ở `tasks.service.ts`: `store.scan(...)` và `store.pipeline()` hai chỗ.

Và kể cả `.store` có tồn tại thì vẫn sai: `scan` / `pipeline` là API của
**ioredis**, không phải của Keyv. Keyv không có hai hàm đó.

### 2b. Phải tách hai tiến trình, vì chúng khác nhau về Redis

Đây là phần quan trọng nhất của việc này — đừng làm một lớp dùng chung.

| | Có Redis không | Làm gì |
|---|---|---|
| **api** (`ProductsService.findOne`) | **có thể không** — `cache.config.ts` rơi về in-memory khi thiếu `REDIS_URL` | đếm là việc **tốt-thì-có**: không có Redis thì **bỏ đếm**, tuyệt đối không được làm route hỏng |
| **worker** (`flushViewCount`) | **chắc chắn có** — `jobs.runner.ts:37-53` từ chối chạy khi thiếu `REDIS_URL` | được phép giả định Redis có thật |

Lấy client ioredis theo **đúng khuôn đã có trong repo**, đừng tự nghĩ kiểu mới:
`src/app.module.ts:92` và `src/ops/jobs/jobs.runner.ts:30`. Đọc comment ở
`app.module.ts:82-99` trước — nó đã kể hai thứ quyết định app sống hay chết:

- `enableOfflineQueue: false` — mặc định ioredis **xếp hàng** lệnh khi mất kết
  nối và chờ, nghĩa là request treo cho tới khi Redis trở lại.
- `client.on('error')` — client ioredis **không có** listener `error` sẽ ném lỗi
  chưa bắt và **giết cả tiến trình Node**.

### 2c. Đếm đang nằm sau chỗ trả về sớm

```ts
const cached = await this.cacheGet<Product>(key);
if (cached) return cached;        // ← trả về sớm
...
await this.cacheManager.store.incr(viewCountKey);   // ← không chạy khi cache trúng
```

Trong 60 giây TTL chỉ lượt xem đầu tiên được đếm. `view_count` sẽ thấp hơn thực
tế hàng chục lần — mà `findAll` có `sort=most_viewed` và `sort=featured` xếp
theo đúng cột này, nên số sai làm sai luôn thứ tự trang chủ.

**Sửa:** tăng đếm **trước** khi kiểm cache.

### 2d. Ba lỗi nhỏ trong `flushViewCount`

- `Object.entries(updates)` trả khoá là **chuỗi**, nhưng truyền vào
  `increment({ id: productId }, ...)` nơi `id` là số. Ép kiểu tường minh.
- Không có `try/catch`, trong khi hai tác vụ nền còn lại trong cùng file đều bọc
  và `logger.error`. Một lượt flush lỗi không được phép làm chết cả lượt chạy.
- Khoảng mất dữ liệu: đọc `GET` rồi `del` — lượt xem đến giữa hai bước bị mất.
  Chấp nhận được, nhưng **ghi rõ là nợ kỹ thuật kèm điều kiện gỡ** trong
  comment, đừng im lặng.

**Nghiệm thu việc 2:**

```bash
npm run build; echo "EXIT=$?"        # EXIT=0
npm run check:boot; echo "EXIT=$?"   # EXIT=0
```

Và một ca đối chứng bắt buộc: **bỏ `REDIS_URL`** rồi gọi `GET /products/:id` —
phải ra **200**, không phải 500. Ghi lại lệnh và kết quả.

---

## Việc 3 — B5-2: bài kiểm "song song" không song song và không thể xanh

`src/catalog/follows/follows.service.spec.ts:110`

```ts
it('hai request song song tạo trùng → database từ chối (khoá UNIQUE)', async () => {
  await service.toggle(1, 2);                            // tạo dòng
  await expect(service.toggle(1, 2)).rejects.toThrow();  // ???
});
```

Không có `Promise.all` — hai lệnh **tuần tự**. Mà `toggle` là toggle: lần hai
tìm thấy `existing` nên nó **xoá** rồi trả `{followed: false}`. Nó không ném.
Bài kiểm này **đỏ bằng cấu trúc**, không phải vì thiếu Docker.

Đúng mục B6 của bản hướng dẫn: một bài kiểm không chuyển được đỏ→xanh thì không
nghiệm thu được gì.

**Sửa:** `Promise.allSettled([service.toggle(1, 2), service.toggle(1, 2)])`, rồi
khẳng định **đúng một** phần tử `rejected`, **đúng một** `fulfilled`, và sau đó
bảng chỉ còn **một** dòng.

**Còn một việc nữa ở file này.** 20 dòng comment đầu file giải thích *"VÌ SAO
DÙNG REPOSITORY GIẢ Ở ĐÂY"*, rồi dán thêm một đoạn `[CẬP NHẬT]` nói ngược lại là
giờ dùng MySQL thật. **Viết lại lý do cho khớp mã**, đừng dán thêm. Comment tự
mâu thuẫn tệ hơn không có comment.

**Ghi lại cho đúng sự thật:** khoá `UNIQUE(follower_id, following_id)` **đã có
sẵn** ở `src/migrations/1690000000000-InitialSchema.ts:70` và `@Unique` trong
`follow.entity.ts`. Nên B5-2 **không có việc sửa mã** — chỉ có việc viết bài
kiểm. Báo cáo lần sau nói đúng như vậy.

---

## Việc 4 — B5-1: chặn quyền nhưng mặc định mở

```ts
// shop.service.ts:130
async getSellerOrders(sellerId, page, limit, status?, user?: { id: number; role: string }) {
  if (user && user.role !== 'admin' && user.id !== sellerId) {
    throw new ForbiddenException('Bạn không có quyền xem đơn hàng này');
  }
```

`user` là tham số **tuỳ chọn** và guard chỉ chạy `if (user)`. Gọi
`getSellerOrders(5, 1, 20)` mà không truyền `user` thì đi qua sạch.

Mà comment ngay trên nó viết: *"đảm bảo bất biến an toàn dù service được gọi từ
bất kỳ đâu (controller, script, job, test)"*. Câu đó **sai so với mã** — chính
cái đường gọi "từ bất kỳ đâu" là đường không bị chặn.

Đây là mặc định **fail-open** của một kiểm tra quyền. Loại lỗi này tệ vì nó im
lặng: không log, không lỗi, chỉ là dữ liệu của người khác chảy ra.

**Sửa:** `user: IUser` **bắt buộc**, bỏ `if (user &&)`. Để tsc là thứ bắt lỗi
chỗ gọi thiếu, đừng để runtime.

**Nghiệm thu:** một ca người bán khác xem đơn của người bán này → 403. Và ca đối
chứng: bỏ guard đi, bài kiểm đó phải đỏ, rồi trả lại.

Phần đổi 500 → 403 thì **đúng**, và `test_output.txt` chứng minh có chạy thật
(`statusCode: 403`).

---

## Việc 5 — B5-3: ghi sai token vào database

Route `POST /auth/refresh` làm **đúng**: `@Public()`, throttle 5/s, có DTO, kiểm
`token_version`, và `logout()` có `increment(..., 'token_version', 1)` nên chống
dùng lại sau đăng xuất là **thật**. Phần này giữ nguyên.

Một lỗi:

```ts
// auth.service.ts
const newRefreshToken = this.createRefreshToken(newPayload);          // trả cho client
await this.usersService.updateUserToken(
  this.jwtService.sign({ sub: user.id, token_version: user.token_version }),  // ← lưu CÁI KHÁC
  user.id.toString());
```

Cái được lưu vào cột `refresh_token` ký bằng **secret access**, payload khác, và
không phải token vừa phát hành. So với `login()` (dòng 88–89) lưu đúng
`refreshToken`.

Hiện chưa ai đọc cột đó để đối chiếu nên chưa thành lỗ bảo mật — nhưng nó là
**dữ liệu sai nằm im**, và mọi logic thu hồi theo cột đó về sau sẽ sai.

**Sửa:** lưu đúng `newRefreshToken`, giống `login()`.

---

## Việc 6 — hạ nợ lint về mốc

```
Nợ lint: 926 (895 lỗi + 31 cảnh báo) — mốc cho phép: 910
Có 16 vấn đề lint MỚI so với mốc.
```

16 lỗi đó đến từ chính loạt thay đổi này. **Sửa mã của mình**, không nâng
`BASELINE`. Bánh cóc chỉ đi xuống — xem mục B7.

Nếu sau khi sửa mà đo được **thấp hơn** 910, hạ `BASELINE` xuống **đúng số đo
được** và nói số đó trong thông điệp commit.

**Nghiệm thu:** `npm run lint:check; echo "EXIT=$?"` → `EXIT=0`.

---

## Việc 7 — dọn

`test_output.txt` đang nằm trong cây (bản dump UTF-16 của một lượt chạy
PowerShell). Xoá nó.

---

## Cách commit

Bảy việc trên là **ít nhất 6 commit riêng**, không gộp. `git log` phải kể được
thứ tự suy nghĩ:

```
fix(tasks): dau dong comment trong chuoi cron lam vo ca file — 62 loi tsc ve 2
fix(view-count): dung ioredis that, khong co Redis thi bo dem chu khong lam sap route
test(follows): ca dua that bang Promise.allSettled — ca cu khong the xanh
fix(shop): bat buoc tham so user — guard dang mac dinh MO
fix(auth): luu dung refresh token vua phat hanh vao DB
style: ha no lint 926 -> <=910
```

Thông điệp tiếng Việt không dấu, giải thích **vì sao**, kèm **số đo**.

**Cây làm việc đang lẫn việc của hai người.** `git commit` không có đường dẫn thì
commit **toàn bộ index**, không chỉ thứ vừa `add`. Commit bằng đường dẫn tường
minh, và sau mỗi commit chạy `git show --stat HEAD` để xem mình vừa commit cái
gì. Tôi đã dính đúng bẫy này hôm qua — xem mục A4 của bản hướng dẫn.

---

## Nghiệm thu cuối — dán đúng những dòng này vào báo cáo

```bash
git status --short                                   # phải SẠCH
npm run build;            echo "build EXIT=$?"
npm run lint:check;       echo "lint EXIT=$?"
npm run openapi:check;    echo "openapi EXIT=$?"
npm run check:boot;       echo "boot EXIT=$?"
npm run check:audit;      echo "audit EXIT=$?"
npm run check:compose;    echo "compose EXIT=$?"
docker start zoldify-test-mysql
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root \
TEST_DB_PASSWORD=testpw TEST_DB_NAME=zoldify_test npm test; echo "test EXIT=$?"
```

Quy tắc duy nhất tôi muốn giữ sau ba vòng vừa rồi: **không có dòng `EXIT=0` thì
không được đánh ✅.**

Cổng nào còn đỏ thì viết thẳng là còn đỏ, dán **nguyên văn** thông báo lỗi, và
**đừng đoán nguyên nhân**. Một báo cáo nói *"còn một cổng đỏ, đây là lỗi"* hữu
ích hơn nhiều một báo cáo toàn ✅ mà người đọc phải đi đo lại. Lần này tôi đo lại
và thấy ba cổng đỏ cùng một lỗi làm sập route sản phẩm.

Nếu đổi nhánh giữa lúc làm, dựng lại database test trước khi chạy test — xem
mục B8.

---

## Không tự quyết

| Không | Vì sao |
|---|---|
| Nâng `BASELINE` lint | bánh cóc chỉ đi xuống |
| `git push` | push `staging` là deploy ngay ra `api-staging.zoldify.com` |
| Sửa `src/money/` | vai A (Đạt) giữ. Viết bài kiểm cho nó thì được |
| `rm -rf .git`, `git init` lại, `git reset --hard`, `git gc --prune` | lịch sử cục bộ đã mất một lần hôm 05/10 và **không phục hồi được** — cả hai bản chụp VSS đều hỏng, và không nhánh nào của ta từng được push |
| Xoá tài liệu cũ | giữ vết, đánh dấu lỗi thời thay vì xoá |
