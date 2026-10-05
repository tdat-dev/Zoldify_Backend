# Rà soát toàn bộ backend — 05/10/2026

**Người rà:** vai B (Cường) · **Quy mô:** 271 file `.ts`, 19.283 dòng mã
(không kể spec), 35 file spec, 239 bài kiểm, 101 route, 23 migration.

> Bản này rà **những mặt chưa từng soi** ở các đợt trước: xác thực đầu vào,
> nuốt lỗi, phụ thuộc, cấu hình khởi động, trùng lặp. Phần đã biết chỉ nhắc
> lại ở mục 4.

---

## 1. Phát hiện MỚI, xếp theo mức nguy hiểm

### 🔴 M-01 · `PATCH /admin/users/:id` ghi được **bất kỳ cột nào**, kể cả mật khẩu

**Chuỗi ba mắt xích, cả ba đều hở:**

```ts
// admin.controller.ts:70
updateUser(@Param('id') id: string, @Body() dto: any) { ... }

// dto/create-admin.dto.ts  — class RỖNG
export class CreateAdminDto {}
export class UpdateAdminDto extends PartialType(CreateAdminDto) {}

// admin.service.ts:113
await this.userRepository.update(id, dto);   // đi thẳng
```

`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` **không bảo
vệ được gì ở đây**: nó chỉ lọc theo các thuộc tính có decorator trên một class
DTO. `dto: any` không phải class, nên pipe không có gì để lọc và cho qua tất cả.

**Hậu quả cụ thể:**

| Gửi lên | Kết quả |
|---|---|
| `{"password":"abc"}` | ghi **chuỗi thô** vào `users.password`. `isValidPassword` dùng bcrypt `compareSync` nên tài khoản đó **không đăng nhập lại được nữa**, và mật khẩu nằm trong DB dạng không băm |
| `{"role":"admin"}` | nâng quyền, không đi qua `changeUserRole` nên **bỏ qua** kiểm `validRoles` |
| `{"token_version":999}` | vô hiệu mọi phiên của người đó |
| `{"is_locked":false}` | mở khoá, bỏ qua `toggleUserLock` (hàm này chặn khoá tài khoản admin) |

Chỉ admin gọi được, nên không phải lỗ leo thang quyền từ ngoài. Nhưng nó biến
**mọi** kiểm tra trong các hàm chuyên dụng (`changeUserRole`, `toggleUserLock`,
`deleteUser` — cả ba đều chặn đụng vào tài khoản admin) thành vô nghĩa, vì có
một cửa sau đi vòng qua hết.

**Sửa:** viết `UpdateUserByAdminDto` thật với `class-validator`, chỉ cho phép
đúng các cột quản trị viên được sửa (`full_name`, `phone_number`, `avatar`,
`email_verified`). **Không** cho `password`, `role`, `token_version`,
`is_locked`, `refresh_token` — ba cái sau đã có route riêng.

### 🔴 M-02 · 48 lỗ hổng trong phụ thuộc production

```
npm audit --omit=dev
48 vulnerabilities (2 low, 14 moderate, 31 high, 1 critical)
```

Một phần đáng chú ý:

| Gói | Vấn đề |
|---|---|
| `engine.io` | Socket.IO Engine.IO Protocol Revision Mismatch **DoS** |
| `ws` ← `socket.io-adapter` | lỗ hổng kéo theo adapter Redis đang dùng |
| `axios` | prototype pollution, chèn được Basic auth |
| `@nestjs/platform-express` ← `multer` | lỗ hổng ở đúng đường tải ảnh lên |
| `form-data` | CRLF injection |
| `@grpc/grpc-js` ← `firebase` | `getAuthContext` |

Thang điểm của thầy có mục *"bảo mật nâng cao"* ở Level 3. Một lệnh
`npm audit` của hội đồng là đủ để thấy con số này.

**Sửa:** chạy `npm audit fix` (không `--force` trước), xem còn lại gì, rồi nâng
từng gói lớn một cách có kiểm soát — mỗi lần nâng là một commit, chạy lại toàn
bộ 239 test.

### 🟠 M-03 · Migration `AddPerformanceIndexes` vẫn **nuốt mọi lỗi**

```ts
// src/migrations/1700000000000-AddPerformanceIndexes.ts
await queryRunner.query(`CREATE INDEX idx_category_id ON products (category_id)`).catch(() => {});
// … 12 dòng nữa cùng kiểu
```

Đây đúng cái mẫu mà `DEPLOY.md` kể lại là đã làm một database **rỗng** tự dán
nhãn *"đã cập nhật tới bản mới nhất"*. `InitialSchema` nay chạy trước nên tình
huống cũ không lặp lại, nhưng **mẫu nguy hiểm vẫn còn**: đổi tên một cột rồi
chạy migration, index tạo hỏng, và không ai được báo.

**Sửa:** đổi sang kiểm `hasIndex`/`hasColumn` rồi mới tạo, hoặc bắt lỗi theo mã
lỗi cụ thể (`ER_DUP_KEYNAME`) chứ không nuốt tất.

### 🟠 M-04 · `POST /auth/register` đi vòng qua chính luồng OTP nằm cạnh nó

Ba route cùng tồn tại, công khai:

```
POST /auth/register/send-otp     gửi mã về email
POST /auth/register/verify-otp   xác thực rồi mới tạo tài khoản
POST /auth/register              tạo tài khoản NGAY, không cần email có thật
```

`AuthService.register()` gọi thẳng `usersService.register()`. Nghĩa là toàn bộ
cơ chế xác thực email là **tuỳ chọn** — ai cũng đăng ký bằng email không tồn
tại. Và `email_verified` của những tài khoản đó không được đặt.

Không rõ đây là tiện ích lúc phát triển còn sót, hay luồng OTP là mã chết.
**Cần người quyết**, đừng tự xoá: nếu web/app đang gọi `/register` thì xoá nó
là làm hỏng đăng ký.

### 🟠 M-05 · Không kiểm biến môi trường lúc khởi động

Có `scripts/check-env.mjs` nhưng phải **chạy tay**. `app.module.ts` dùng
`ConfigModule.forRoot({ isGlobal: true })` không có `validationSchema`.

Hậu quả: thiếu `JWT_ACCESS_SECRET` thì app vẫn khởi động bình thường và ký mọi
token bằng **chuỗi rỗng** — một lỗi im lặng tuyệt đối, chỉ lộ khi có người thử
giả token.

**Sửa:** thêm `validationSchema` (Joi hoặc kiểm tay) cho nhóm biến bắt buộc, để
thiếu là **dừng ngay lúc khởi động** chứ không chạy tiếp.

### 🟡 M-06 · Hai bản cài đặt trùng nhau cho cùng một việc

| | |
|---|---|
| `settings.service.ts:51` | `update(updates)` — upsert từng khoá |
| `admin.service.ts:172` | `updateSettings(updates)` — **chép y hệt** |

Hai bản sẽ lệch nhau vào ngày ai đó sửa một bên. `AdminService` nên gọi
`SettingsService` thay vì tự cài lại.

### 🟡 M-07 · `changeUserRole` nhận kiểu inline, không qua DTO

```ts
changeUserRole(@Param('id') id: string, @Body() dto: { role: string })
```

Service có kiểm `validRoles` nên không thủng, nhưng `ValidationPipe` không chặn
được field thừa ở đây. Cùng loại với M-01, mức nhẹ hơn.

### 🟡 M-08 · `console.log` lẫn với `JsonLogger`

`main.ts` (3 chỗ) và `redis-io.adapter.ts` (1 chỗ) in bằng `console.log`, trong
khi dự án có `src/common/json-logger.ts` và `npm run log:summary` đọc log JSON
ra bảng p50/p95. Bốn dòng này không vào được bảng đó.

### 🟡 M-09 · N+1 nhỏ trong upsert cài đặt

`settings.update()` chạy một `findOne` cho **mỗi** khoá trong vòng lặp. Bảng
settings chỉ vài chục dòng nên chưa đau, nhưng đó là mẫu sẽ bị chép sang chỗ
khác.

---

## 2. Những thứ đã kiểm và **không** có vấn đề

Ghi lại để người sau không phải rà lại:

| Mặt | Kết quả |
|---|---|
| Route `@Public` | 26 route, tất cả đều hợp lý: đọc catalog, sitemap, cửa vào auth, hai webhook (đều có chữ ký/token riêng), health, settings công khai |
| Controller không guard | **không có** — mọi controller có route ghi đều gắn guard |
| `synchronize` | `false` ở cả 4 nơi |
| Soft delete | không chỗ nào dùng `withDeleted` sai; TypeORM tự lọc |
| Mật khẩu trả ra API | không; `findOneByEmail` có select `password` nhưng chỉ để `compareSync`, và `validateUser` bóc ra trước khi trả |
| Helmet · CORS · ValidationPipe toàn cục | có đủ |
| Rate limit | 3 tầng (1s/10s/60s) + `@Throttle` riêng cho login, OTP, quên mật khẩu |

---

## 3. Việc còn lại từ các đợt trước (nhắc lại ngắn)

| Mã | Việc |
|---|---|
| **A1** | Hoà `origin/staging` — nay **53 commit**, 7 file xung đột, 10/17 khối trong mã tiền |
| **A2** | Push + deploy — phải kiểm cổng 80/443 trên VPS trước |
| **B1** | Task #26b tồn kho real-time — **ô Level 3**, làm sau A1 |
| **B2** | Task #35 trang admin đối soát ledger |
| **B3** | 3 câu SQL mức CAO (`sitemap:65`, `products:302`, `shop:110`) |
| **B4** | `sql-audit.md` lỗi thời; `sql:audit` chưa bao giờ chạy trọn |
| **B5** | 4 lỗ cả hai đợt soát xét chưa chạm (`shop.controller:68` trả 500; không có refresh endpoint; `follows` thiếu UNIQUE; `view_count` tắt) |
| **B6** | 3 module trắng test: `firebase`, `ghn` (chờ hoà), `files` (cố ý không viết) |
| **B7** | `test:e2e` chưa bao giờ chạy trong CI |

Chi tiết đầy đủ: `docs/bao-cao/ke-hoach-ban-giao-backend.md`.

---

## 4. Kế hoạch từng bước

> **Bảy cái bẫy bắt buộc đọc trước:** `ke-hoach-ban-giao-backend.md` mục 0.
> Mỗi bước dưới đây đều theo 6 bước: pull → pre-mortem → **test đỏ trước** →
> nhánh phụ → nghiệm thu bằng chính test đó → xanh hết mới gộp.

### Giai đoạn 1 — Sửa nhanh, không chờ ai (làm được ngay hôm nay)

Ba việc này **không đụng** file xung đột với Đạt, làm trước không tốn công gì.

#### Bước 1.1 · Vá M-01 (nửa buổi) — `feat/vaM01-dto-admin`

1. Viết spec `src/ops/admin/admin.service.spec.ts` với 4 ca, chạy, **xác nhận đỏ**:
   - gửi `{password:'abc'}` → phải bị từ chối, và `users.password` **không đổi**
   - gửi `{role:'admin'}` → bị từ chối (đã có route riêng)
   - gửi `{token_version:999}` → bị từ chối
   - gửi `{full_name:'X'}` → thành công
2. Viết `src/ops/admin/dto/update-user-by-admin.dto.ts`:
   ```ts
   export class UpdateUserByAdminDto {
     @IsOptional() @IsString() @Length(1, 100) full_name?: string;
     @IsOptional() @IsString() @Length(8, 20)  phone_number?: string;
     @IsOptional() @IsString() avatar?: string;
     @IsOptional() @IsBoolean() email_verified?: boolean;
   }
   ```
3. Đổi `admin.controller.ts:70` dùng DTO đó; đổi `changeUserRole` sang
   `ChangeRoleDto` có `@IsIn(['buyer','seller','admin','moderator'])` (vá M-07
   luôn, cùng file).
4. Xoá `create-admin.dto.ts` và `update-admin.dto.ts` nếu không còn ai dùng.
5. **Ca đối chứng:** bỏ `forbidNonWhitelisted` khỏi ValidationPipe → 3 ca phải đỏ.
6. Nghiệm thu: `npm test` · `npm run check:boot` · `lint:check` · `openapi:gen`.

#### Bước 1.2 · Vá M-05 (1 giờ) — `feat/vaM05-kiem-env`

1. Viết spec: nạp `AppModule` với `JWT_ACCESS_SECRET` rỗng → **phải ném**.
   Chạy, xác nhận đỏ (hiện tại nó khởi động bình thường).
2. Thêm kiểm vào `ConfigModule.forRoot({ validate })` cho nhóm bắt buộc:
   `DB_HOST`, `DB_USERNAME`, `DB_DATABASE`, `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_TOKEN_SECRET`.
3. Thông báo lỗi phải **nêu tên biến** và nhắc `npm run env:check`.
4. Nghiệm thu: `check:boot` vẫn xanh (CI đã có đủ biến), spec mới xanh.

#### Bước 1.3 · Vá M-03, M-06, M-08 (1 giờ) — `chore/don-ba-no-nho`

- **M-03**: đổi `.catch(() => {})` trong `AddPerformanceIndexes` sang kiểm
  `hasIndex` trước khi tạo. Nghiệm thu: dựng `zoldify_schema` **từ số không**,
  chạy 23 migration, `check:drift` 0 dòng lệch.
- **M-06**: `AdminService` inject `SettingsService`, xoá bản chép.
  Nghiệm thu: spec `settings` hiện có vẫn xanh.
- **M-08**: 4 `console.log` → `Logger` của Nest. Nghiệm thu: `npm run log:summary`
  đọc được.

**Mỗi việc một commit riêng.**

### Giai đoạn 2 — Phụ thuộc (nửa buổi) — `chore/va-lo-hong-phu-thuoc`

#### Bước 2.1 · Chụp ảnh trước

```bash
npm audit --omit=dev --json > /tmp/audit-truoc.json
npm test   # ghi lại 239/239
```

#### Bước 2.2 · Vá dần, mỗi nhóm một commit

```bash
npm audit fix            # KHÔNG --force ở lần đầu
npm test                 # phải vẫn 239/239
npm run check            # 13 suite
```

Còn lại gì thì nâng từng gói lớn một (`axios`, `firebase`, `socket.io`), **mỗi
gói một commit**, chạy lại toàn bộ test sau mỗi lần. Gói nào nâng làm đỏ test
thì dừng, ghi lại số hiệu lỗ hổng và lý do chưa nâng được — **đừng** `--force`
để lấy con số đẹp.

#### Bước 2.3 · Ghi lại

Viết `docs/bao-cao/va-lo-hong-phu-thuoc.md`: trước bao nhiêu, sau bao nhiêu,
cái nào chưa vá được và vì sao. Đây là thứ trả lời được câu hỏi của hội đồng về
"bảo mật nâng cao".

### Giai đoạn 3 — Hoà nhánh (cần người thật)

#### Bước 3.1 · Mở quyền

Người dùng gõ `!git merge --no-ff origin/staging` (lệnh `git merge` bị bộ phân
loại chặn với trợ lý AI).

#### Bước 3.2 · Gỡ 7 file theo bảng đã đối chiếu ở **mức hàm**

Bảng quyết định: `docs/bao-cao/doi-chieu-hai-dot-soat-xet.md` mục 7.
Tóm tắt: giữ cả hai ở `payments`/`escrows`/`products`/`compose`; `findByOrder`
lấy bản Đạt; `address.entity` lấy nguyên bản Đạt; **`orders.service.ts` phải
viết lại tay** vùng tính phí ship.

**Dừng và hỏi người** nếu có khối nào hai bên sửa cùng một thân hàm với ý khác
nhau.

#### Bước 3.3 · Nghiệm thu sau hoà

```bash
# BẮT BUỘC dựng lại DB test — xem bẫy 0.3
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "DROP DATABASE IF EXISTS zoldify_test; CREATE DATABASE zoldify_test
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run build && npm test     # xanh CẢ test của Đạt LẪN của ta
npm run check                 # 13 suite
npm run lint:check            # ĐO lại rồi đặt đúng số đo được
```

Thêm `mem_limit` cho dịch vụ `backup` mới của Đạt, nếu không `check:compose` đỏ.

### Giai đoạn 4 — Sau khi hoà

#### Bước 4.1 · Task #26b tồn kho real-time · **ô Level 3**

Kế hoạch chi tiết: `ke-hoach-task-15-va-26b.md` mục 2. Thiết kế đã chốt:
Redis pub/sub (vì worker không có socket server), namespace `/stock` file mới,
room theo sản phẩm, phát **sau commit**, thêm `npm run check:stock`.

**Đừng** dùng `EntitySubscriber` — đã kiểm, chỗ trừ kho chính đi bằng SQL thô.

#### Bước 4.2 · B5 — bốn lỗ còn lại, mỗi lỗ một commit

1. `shop.controller.ts:68` → `ForbiddenException`, và chuyển phép kiểm xuống service.
2. `follows` → migration thêm `UNIQUE(follower_id, following_id)`; đổi ca ghi
   nhận trong `follows.service.spec.ts` thành "database từ chối", chuyển sang
   MySQL thật.
3. `view_count` → Redis `INCR` + flush theo lô, đúng như TODO đã ghi.
4. Refresh token → **hỏi C/D trước**, có thể là mobile cần sửa chứ không phải backend.

#### Bước 4.3 · B3 + B4 — SQL và tài liệu đo

1. Sửa seed để tạo ba tài khoản `buyer/seller/admin@zoldify.com` mật khẩu
   `123456` → `sql:audit` mới chạy trọn được.
2. Dựng `zoldify_sqlaudit`, `EXPLAIN` 3 câu CAO **trước** khi sửa, ghi số đo.
3. Sửa, `EXPLAIN` lại, `npm run check:index` phải xanh.
4. `npm run sql:audit` chạy trọn → sinh lại `sql-audit.md`.

#### Bước 4.4 · Task #35 trang admin đối soát ledger

Dùng `LedgerService.getBalance()` và kết quả job đối soát của task #32.
`GET /admin/audit-logs` là mẫu sẵn cho route admin có phân trang và trần limit.

#### Bước 4.5 · B6 + B7

- Spec cho `firebase` và `ghn` (sau khi hoà, vì Đạt vừa sửa cả hai).
- `test:e2e`: nối vào CI, hoặc xoá và ghi rõ vì sao.

---

## 5. Thứ tự ưu tiên nếu không đủ thời gian

| Hạng | Việc | Vì sao |
|---|---|---|
| 1 | **Giai đoạn 3** (hoà + push) | không có nó thì **không dòng nào ra tới người dùng** |
| 2 | **M-01** | một cửa sau vô hiệu hoá mọi kiểm tra quản trị khác |
| 3 | **M-02** | hội đồng gõ `npm audit` là thấy |
| 4 | **B1 (#26b)** | ô Level 3, và #15 đã xong nên còn đúng một ô |
| 5 | M-05, M-03 | lỗi im lặng, rẻ để vá |
| 6 | Phần còn lại | |

**Không** đánh đổi: báo cáo ≥50 trang tiếng Anh và slide vẫn là thứ chặn việc
bảo vệ, và chúng đang ở số 0. Mã có hoàn hảo mà không có báo cáo thì không được
bảo vệ.
