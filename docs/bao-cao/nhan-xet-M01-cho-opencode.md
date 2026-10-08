# Nhận xét bản vá M-01 — việc còn phải làm

**Gửi:** OpenCode (hoặc ai làm tiếp) · **Người nhận xét:** vai B
**Đối tượng:** commit `840b19d` trên nhánh `feat/task-15-goi-y-san-pham`
**Ngày:** 05/10/2026

> Mọi con số dưới đây đều **đo lại được** bằng lệnh ghi kèm. Đừng tin bản nhận
> xét này, hãy chạy lại — đó cũng chính là điều lẽ ra phải làm với bản báo cáo
> `danh-gia-M01-va-ghi-cot-nhay-cam.md`.

---

## 1. Phần đã làm đúng — giữ nguyên, đừng sửa lại

| Thứ | Vị trí |
|---|---|
| `UpdateUserByAdminDto` chỉ 4 cột an toàn, `class-validator` đủ | `src/ops/admin/dto/update-user-by-admin.dto.ts` |
| `ChangeRoleDto` có `@IsIn([...])` (vá luôn M-07) | `src/ops/admin/dto/change-role.dto.ts` |
| Guard tường minh trong service, 5 cột cấm | `src/ops/admin/admin.service.ts:112-119` |
| Xoá hai DTO rỗng `CreateAdminDto` / `UpdateAdminDto` | đã xoá |
| 4 ca kiểm, chạy lại lần hai vẫn xanh | `src/ops/admin/admin.service.spec.ts` |

Phòng thủ hai lớp (DTO ở controller + guard ở service) là đúng. **Không gỡ lớp
nào.**

Đo lại được:
```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root \
TEST_DB_PASSWORD=testpw TEST_DB_NAME=zoldify_test npm test
# → Tests: 243 passed, 36 suites
```

---

## 2. Hai câu trong báo cáo cũ là SAI — và vì sai nên việc chưa được làm

### 2.1 "lint 6 lỗi quá mốc — **nợ cũ**, thay đổi này không thêm lỗi mới"

Sai. Đo hai mốc:

```bash
git stash -u
git checkout e687e98 && npm run lint:check   # → 913 / mốc 913  ✅
git checkout 840b19d && npm run lint:check   # → 919 / mốc 913  ❌
```

Chênh **+6 đến từ chính commit này**, không phải nợ cũ. Chi tiết: 7 cảnh báo
mới, 1 lỗi được sửa.

### 2.2 "openapi:gen lỗi alias path `@ops/*` — **vấn đề cũ** của tsconfig"

Sai. Nó chạy bình thường:

```bash
npm run openapi:gen
# → Đã ghi openapi.json — 101 route, 63 schema.
```

Vấn đề thật khác hẳn: hai DTO mới sinh thêm **2 schema**, nhưng `openapi.json`
trong git **chưa được sinh lại**. Hậu quả:

```bash
npm run openapi:check   # → EXIT 1   ❌ cổng CI đang đỏ
```

Vì bị gắn nhãn "vấn đề cũ của tsconfig" nên không ai đi sinh lại file.

---

## 3. Năm việc phải làm

Làm theo thứ tự. **Mỗi việc một commit riêng** — `git log` phải kể được thứ tự
suy nghĩ.

### Việc 1 · Đưa lint về ≤ 913

**Ở đâu:** `src/ops/admin/admin.service.spec.ts`

7 cảnh báo `@typescript-eslint/no-unsafe-argument`:

| Dòng | Nguyên nhân |
|---|---|
| 82-86 | truyền `{} as any` làm repository giả cho `Order`, `Product`, `Setting`, `Withdrawal`, `WithdrawalsService` |
| 128, 140, 151 | `service.updateUser(ID.target, { password: 'abc' } as any)` |

**Cách sửa — hai chỗ, hai cách khác nhau:**

Dòng 82-86: khai kiểu thật thay vì `any`.
```ts
{} as unknown as Repository<Order>
```
(xem `src/money/wallets/wallets.service.spec.ts` dòng ~75 làm mẫu — nó truyền
`{} as Repository<Wallet>` kèm comment giải thích vì sao repository đó không
được dùng tới.)

Dòng 128/140/151: payload cố tình sai kiểu là **có chủ đích** — đó là điểm của
bài kiểm. Dùng `as unknown as UpdateUserByAdminDto` và **ghi comment một dòng**
nói rõ vì sao phải ép kiểu: *"cố tình gửi cột cấm — đây chính là thứ bài kiểm
gác, nên ép kiểu ở đây là đúng."*

**Nghiệm thu:**
```bash
npm run lint:check    # Nợ lint phải ≤ 913, EXIT 0
```

**KHÔNG được** nâng `BASELINE` trong `scripts/check-lint.mjs`. Bánh cóc chỉ đi
xuống. Nếu sau khi sửa số còn **thấp hơn** 913 thì hạ mốc xuống **đúng số đo
được**, không chọn bừa.

### Việc 2 · Sinh lại `openapi.json`

```bash
npm run openapi:gen
git add openapi.json
```

**Nghiệm thu:**
```bash
npm run openapi:check   # EXIT 0
```
Kỳ vọng: **101 route, 63 schema** (61 → 63 vì hai DTO mới).

### Việc 3 · Gỡ `Project.txt` khỏi git

Commit `840b19d` đã đưa `Project.txt` (+65 dòng) vào git. File này trước giờ
**cố ý để untracked** — `docs/bao-cao/tinh-trang-2026-09-28.md` ghi rõ *"đề bài
của thầy, cố ý không commit"*. Kiểm:

```bash
git log --oneline --all -- Project.txt
# → chỉ có 840b19d. Trước đó chưa từng được commit.
```

**Làm:**
```bash
git rm --cached Project.txt
echo "Project.txt" >> .gitignore
```

**Nghiệm thu:** `git status --short` không còn thấy `Project.txt` ở cả vùng theo
dõi lẫn vùng chưa theo dõi.

### Việc 4 · Khôi phục ký tự xuống dòng của `admin.controller.ts`

Commit hiện ra **338 dòng thay đổi**, nhưng nội dung thật chỉ có:

```bash
git diff e687e98 840b19d --ignore-all-space -- src/ops/admin/admin.controller.ts
# → 5 insertions(+), 3 deletions(-)
```

330 dòng còn lại là viết lại toàn bộ CRLF/LF. `origin/staging` đang có **53
commit chưa hoà**, và một file bị viết lại toàn bộ sẽ thành vùng xung đột trọn
vẹn mà không đổi được gì.

**Làm:** lấy lại bản gốc rồi áp đúng 5 dòng thật.

```bash
git checkout e687e98 -- src/ops/admin/admin.controller.ts
```

Rồi sửa tay đúng ba chỗ sau (và **chỉ** ba chỗ này):

```diff
+import { UpdateUserByAdminDto } from './dto/update-user-by-admin.dto';
+import { ChangeRoleDto } from './dto/change-role.dto';

-  changeUserRole(@Param('id') id: string, @Body() dto: { role: string }) {
+  changeUserRole(@Param('id') id: string, @Body() dto: ChangeRoleDto) {

-  @ResponseMessage('Cập nhập người dùng thành công')
-  updateUser(@Param('id') id: string, @Body() dto: any) {
+  @ResponseMessage('Cập nhật người dùng thành công')
+  updateUser(@Param('id') id: string, @Body() dto: UpdateUserByAdminDto) {
```

**Nghiệm thu:**
```bash
git diff --stat -- src/ops/admin/admin.controller.ts
# phải ra khoảng 5-8 dòng, KHÔNG phải 338
npm run build   # xanh
```

**Mẹo tránh lặp lại:** đừng dùng công cụ ghi lại cả file khi chỉ đổi vài dòng.
Nếu editor tự đổi xuống dòng, chạy `npx eslint --fix <file>` thay vì sửa tay.

### Việc 5 · Thêm MỘT ca kiểm đi qua HTTP

**Vì sao bắt buộc.** Cả 4 ca hiện có đều gọi thẳng `service.updateUser(...)`:

```bash
grep -n "service.updateUser" src/ops/admin/admin.service.spec.ts
# → dòng 128, 140, 151, 159 — không ca nào đi qua HTTP
```

`ValidationPipe` **chỉ chạy khi request đi qua HTTP**. Nghĩa là nửa "chặn ở
controller bằng DTO" hiện đang được **khẳng định chứ không được chứng minh**.
Nếu ai lỡ tay đổi `@Body() dto: UpdateUserByAdminDto` về `any`, bộ test vẫn
xanh — đúng cái lỗ vừa vá sẽ mở lại mà không ai biết.

**Làm:** theo khuôn có sẵn `scripts/selfcheck-audit.ts` — nó đã dựng app thật,
tạo admin thật, ký token thật và gọi route thật. Thêm một mục:

```
PATCH /api/v1/admin/users/:id   body {"password":"abc"}
  → kỳ vọng HTTP 400
  → và đọc lại DB: cột users.password KHÔNG đổi
```

Đặt vào `scripts/selfcheck-audit.ts` (đã có sẵn trong `npm run check` và trong
`ci.yml`) chứ **đừng** tạo script mới — một cổng mới mà quên nối vào CI thì
không phải là cổng.

**Nghiệm thu:**
```bash
npm run check:audit   # TẤT CẢ PASS
```

**Ca đối chứng bắt buộc:** tạm đổi `@Body() dto: UpdateUserByAdminDto` về
`any`, chạy lại → mục mới **phải đỏ**. Rồi trả lại. Không làm bước này thì
không biết ca mới có gác được gì không.

---

## 4. Nghiệm thu cuối — tất cả phải xanh cùng lúc

```bash
# dựng lại DB test TRƯỚC (bắt buộc — xem mục 5)
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "DROP DATABASE IF EXISTS zoldify_test; CREATE DATABASE zoldify_test
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

npm run build                       # xanh
npm test                            # 243/243 (hoặc hơn nếu thêm ca)
npm run lint:check                  # ≤ 913, EXIT 0
npm run openapi:check               # EXIT 0
npm run check:boot                  # TẤT CẢ PASS
npm run check:audit                 # TẤT CẢ PASS
npm run check:compose               # TẤT CẢ PASS
git status --short                  # chỉ còn thứ cố ý untracked
```

**Chưa xanh hết thì chưa xong.** Luật 6 bước của dự án là *"xanh hết mới gộp"*,
và gắn nhãn "nợ cũ" cho một cổng đỏ không làm nó xanh.

---

## 5. Năm cái bẫy — đọc trước khi gõ dòng đầu tiên

1. **Database test nhiễm giữa các nhánh.** Đổi nhánh rồi chạy test mà không
   dựng lại `zoldify_test` thì `synchronize` sẽ đòi xoá index của nhánh kia và
   MySQL từ chối → hàng chục test đỏ vì dữ liệu cũ, không phải vì mã sai. Đã
   xảy ra thật: 48 test đỏ, suýt bị báo cáo thành "staging hỏng".

2. **Test phải chạy được LẦN HAI.** Spec hiện tại dùng dải id ngẫu nhiên — tốt,
   giữ nguyên. Đừng đổi sang id cố định.

3. **Toàn bộ suite đỏ cùng một thông báo → nghi fixture trước, nghi mã sau.**
   Đã xảy ra: thiếu `receiver_name` NOT NULL làm cả 8 ca đỏ giống hệt nhau.

4. **Bánh cóc lint chỉ đi xuống.** Không nâng `BASELINE` để đi qua. Dọn được
   thì hạ xuống **đúng số đo được**.

5. **Đừng kết luận ở mức file khi mới đọc thống kê dòng.** "338 dòng thay đổi"
   nghe như một sửa đổi lớn; đọc bằng `--ignore-all-space` thì chỉ có 5 dòng.
   Ngược lại, "6 lỗi lint" nghe như nhỏ, nhưng đo hai mốc mới biết nó đến từ
   đâu.

---

## 6. KHÔNG được làm

| Không | Vì sao |
|---|---|
| Nâng `BASELINE` trong `check-lint.mjs` | bánh cóc chỉ đi xuống |
| Gỡ guard trong service hoặc DTO ở controller | hai lớp là có chủ đích |
| Sửa bất cứ thứ gì trong `src/money/` | vai A (Đạt) giữ phần này |
| `git push` | push vào `staging` là **deploy ngay**, và cần kiểm cổng 80/443 trên VPS trước |
| `npm audit fix --force` | ngoài phạm vi việc này |
| Tạo script tự kiểm mới cho việc 5 | nối vào `selfcheck-audit.ts` đã có trong CI |

---

## 7. Một câu về cách viết báo cáo

Bản `danh-gia-M01-va-ghi-cot-nhay-cam.md` viết rất gọn và đúng khuôn, nhưng hai
chỗ sai đều rơi vào **mục nghiệm thu**, và đều sai theo hướng làm việc trông
như đã xong: một cổng đỏ thành "nợ cũ", một cổng đỏ thành "vấn đề cũ của
tsconfig".

Khi ghi kết quả một cổng, ghi **số đo** và **lệnh đo**, không ghi phán đoán về
nguyên nhân. Nếu tin đó là nợ cũ thì đo mốc trước để chứng minh — đúng một lệnh
`git checkout <commit trước> && npm run lint:check`.
