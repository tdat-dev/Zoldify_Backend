# M-01 — ba việc còn lại, và cách làm việc ở repo này

**Gửi:** OpenCode · **Người viết:** vai B (Cường) · **Ngày:** 05/10/2026

Phần kỹ thuật bạn làm **tốt**: DTO đúng, guard đặt đúng chỗ, lần này còn chữa
đúng nguyên nhân của lỗi alias thay vì vá triệu chứng, và ca đối chứng là có
thật. Lint 910 thấp hơn mốc cũ — đó là tiến bộ thật.

Chỗ lệch nằm ở **bước cuối và cách ghi nghiệm thu**, không nằm ở kỹ năng viết
mã. Phần B giải thích vì sao repo này khó tính đúng ở chỗ đó.

---

# A. Ba việc còn lại

## A0. Trước hết: việc đang nằm ngoài commit

```bash
git log --oneline -1
# 84a1d42  ← vẫn là commit của báo cáo TRƯỚC

git status --short
#  M .gitignore
# D  Project.txt
#  D docs/bao-cao/danh-gia-M01-va-ghi-cot-nhay-cam.md
#  M openapi.json
#  M scripts/selfcheck-audit.ts
#  M src/common/guards/maintenance.guard.ts
# MM src/ops/admin/admin.controller.ts
```

Toàn bộ việc bạn vừa làm đang ở **cây làm việc**, chưa vào git. `M01-final-report.md`
ghi *"Commit `84a1d42` · 7/7 xanh"*, nhưng `84a1d42` **không chứa** những thay
đổi đó — nó là commit cũ.

Đây là lý do gốc của cả ba vòng vừa rồi: **chạy lệnh trong cây làm việc rồi ghi
kết quả như thể nó đã nằm trong git.**

## A1. `openapi.json` — chỉ còn thiếu `git add`

Đây là lần thứ ba cổng này đỏ, nhưng lần này lý do **khác hai lần trước**, và
nó là một cái bẫy thật của repo — không phải lỗi cẩu thả. Xem định nghĩa cổng:

```jsonc
// package.json:26
"openapi:check": "npm run openapi:gen && git diff --exit-code openapi.json"
```

`git diff` (không có `--cached`) so **cây làm việc với INDEX**, không so với bản
sinh ra. Nghĩa là cổng này không hỏi *"file có đúng không"*, nó hỏi
***"file đã được đưa vào git chưa"***.

Số tôi đo lúc 05/10:

```
bản sinh ra / cây làm việc : 101 route, 63 schema   ← ĐÚNG
openapi.json trong HEAD    : 101 route, 56 schema   ← cũ
npm run openapi:check      : EXIT 1
```

Bạn đã chữa đúng nguyên nhân (hoàn nguyên `maintenance.guard.ts` về alias
`@ops/settings` thay vì vá một import — **đúng cách**) và đã sinh lại file.
Thiếu đúng một bước: file mới chưa vào index.

> **Con số 56 lẽ ra phải làm bạn dừng lại ở vòng trước.** Mốc trước khi làm
> M-01 là **61** schema. Thêm hai DTO thì phải **nhiều hơn** 61, không thể ít
> hơn. Một con số đi sai hướng là **tín hiệu**, không phải kết quả — xem B3.

**Làm:**
```bash
npm run openapi:gen
git add openapi.json
npm run openapi:check; echo "EXIT=$?"
```

**Nghiệm thu:** `EXIT=0`, và file có **63 schema**:
```bash
node -e "console.log(Object.keys(require('./openapi.json').components.schemas).length)"
# 63
```

> Lưu ý: git có cảnh báo `LF will be replaced by CRLF` cho file này. Nếu sau khi
> commit mà `openapi:check` vẫn đỏ với diff cả file, đó là xuống dòng chứ không
> phải nội dung — kiểm bằng `git diff --ignore-all-space --stat openapi.json`
> (ra 0 dòng ⇒ chỉ là CRLF). Cùng một họ bẫy với A2.

## A2. `admin.controller.ts` — khôi phục ký tự xuống dòng

```bash
git diff e687e98 --ignore-all-space --stat -- src/ops/admin/admin.controller.ts
# 5 insertions(+), 3 deletions(-)      ← nội dung ĐÚNG

git diff e687e98 --stat -- src/ops/admin/admin.controller.ts
# 170 insertions(+), 168 deletions(-)  ← nhưng vẫn viết lại CẢ FILE
```

Nội dung bạn sửa là đúng. Vấn đề là cả file bị đổi ký tự xuống dòng (CRLF ↔ LF),
nên git thấy 338 dòng thay đổi.

**Vì sao điều này quan trọng ở đây:** `origin/staging` đang có **53 commit chưa
hoà**, trong đó Đạt cũng sửa vùng admin. Một file bị viết lại toàn bộ sẽ thành
**vùng xung đột trọn vẹn** khi hoà — tốn hàng giờ gỡ, mà không đổi được gì.

**Làm:**
```bash
git checkout e687e98 -- src/ops/admin/admin.controller.ts
```

Rồi sửa tay **đúng ba chỗ**, không hơn:

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
git diff e687e98 --stat -- src/ops/admin/admin.controller.ts
# phải ra ~8 dòng, KHÔNG phải 338
npm run build   # xanh
```

**Mẹo:** khi chỉ đổi vài dòng, đừng dùng công cụ ghi lại cả file. Nếu editor tự
đổi xuống dòng thì `npx eslint --fix <file>` sẽ chuẩn hoá lại theo cấu hình repo.

## A3. Giữ lại báo cáo cũ, đừng xoá

```
 D docs/bao-cao/danh-gia-M01-va-ghi-cot-nhay-cam.md
```

Đó là bản báo cáo đầu tiên — bản có hai câu sai. **Đừng xoá nó.**

`git log` ở repo này phải kể được **thứ tự suy nghĩ**, kể cả những khúc sai.
Người đọc sau cần thấy "đã từng kết luận thế này, hoá ra sai, vì sao" — đó là
thứ ngăn người kế tiếp lặp lại. Xoá đi thì chỉ còn một chuỗi toàn ✅, và không
ai học được gì.

**Làm:**
```bash
git checkout -- docs/bao-cao/danh-gia-M01-va-ghi-cot-nhay-cam.md
```

Rồi thêm **một dòng** ở đầu file đó:

```markdown
> **Lỗi thời 05/10.** Hai câu ở mục 4 sai (lint "nợ cũ", openapi "lỗi tsconfig").
> Xem `nhan-xet-M01-cho-opencode.md` và `huong-dan-va-viec-con-lai-M01.md`.
```

## A4. Commit, rồi mới nghiệm thu

```bash
git add -A
git commit            # xem B4 về cách viết thông điệp
git status --short    # phải SẠCH

# rồi mới chạy 7 cổng
npm run build
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root \
TEST_DB_PASSWORD=testpw TEST_DB_NAME=zoldify_test npm test
npm run lint:check
npm run openapi:check
npm run check:boot
npm run check:audit
npm run check:compose
```

> **Bẫy tôi vừa dính, 10 phút trước khi viết dòng này.** Cây làm việc đang lẫn
> việc của hai người. Tôi chạy `git add <file tài liệu>` rồi `git commit` —
> và commit cuốn theo cả `Project.txt` đã xoá cùng bản staged của
> `admin.controller.ts`, vì **`git commit` không có đường dẫn thì commit TOÀN BỘ
> index**, không chỉ thứ mình vừa `add`.
>
> ```bash
> git show --stat HEAD      # 3 file, không phải 1
> git reset --soft HEAD~1   # trả index về nguyên trạng
> git commit -F msg -- <đúng-một-đường-dẫn>
> ```
>
> Khi cây làm việc còn lẫn việc đang dở, commit bằng **đường dẫn tường minh**,
> và luôn `git show --stat HEAD` sau khi commit để xem mình vừa commit cái gì.
> Mục A4 bảo "commit rồi mới nghiệm thu" — thì đây là bước nghiệm thu của chính
> cái commit đó.

---

# B. Cách làm việc ở repo này

Phần này không phải quy tắc cho vui. Mỗi mục dưới đây sinh ra từ một lần hỏng
có thật, và tôi ghi lại chuyện đó để bạn thấy nó không trừu tượng.

## B1. Chỉ đánh ✅ cho thứ **đã chạy** trên cây **đã commit**

Ba vòng vừa rồi, mỗi vòng đều có ô ✅ cho việc chưa xảy ra:

| Vòng | Ô ✅ | Thực tế |
|---|---|---|
| 1 | "lint: nợ cũ, không thêm lỗi mới" | +6 đến từ chính commit đó (913 → 919) |
| 1 | "openapi: lỗi alias tsconfig, vấn đề cũ" | `openapi:gen` chạy bình thường; cổng đỏ vì file chưa sinh lại |
| 2 | "Project.txt đã gỡ ✅" | `git ls-files Project.txt` vẫn trả về file |
| 2 | "controller 8 dòng vs 338 ✅" | vẫn 338 |
| 3 | "7/7 xanh, commit 84a1d42" | việc nằm ngoài commit; `openapi:check` EXIT 1 |

Không ai cố tình ghi sai. Nó xảy ra vì **viết báo cáo theo ý định** chứ không
theo kết quả lệnh.

**Cách tránh:** dán **mã thoát thật** vào báo cáo.

```bash
npm run openapi:check; echo "EXIT=$?"
```

Nếu bạn không dán được `EXIT=0`, ô đó chưa được đánh ✅.

## B2. Số đo là bằng chứng; phán đoán nguyên nhân thì không

*"Nợ cũ"*, *"vấn đề cũ của tsconfig"* — đó là **giả thuyết**, và cả hai đều sai.
Kiểm một giả thuyết như vậy tốn đúng một lệnh:

```bash
git stash -u
git checkout <commit-truoc> && npm run lint:check   # 913
git checkout <commit-nay>  && npm run lint:check    # 919  → không phải nợ cũ
```

Nếu chưa đo thì viết *"nghi là nợ cũ, **chưa kiểm**"*. Câu đó trung thực và vẫn
hữu ích. Câu "nợ cũ" khi chưa đo thì làm người đọc bỏ qua một việc cần làm.

## B3. Một con số đi sai hướng là tín hiệu, không phải kết quả

`openapi.json` có **56** schema, trong khi mốc trước đó là **61** và vừa thêm
hai DTO. Con số phải tăng, nhưng nó giảm.

Khi gặp một con số không khớp với hướng mình mong đợi, **dừng lại và hỏi vì
sao** trước khi ghi nó vào báo cáo. Ở đây nó đang nói: "bản sinh ra lúc hệ đang
hỏng dở".

Cùng loại: nếu **toàn bộ** một suite đỏ với cùng một thông báo, nghi **fixture**
trước, nghi mã sau. Đã xảy ra: thiếu `receiver_name` NOT NULL làm cả 8 ca đỏ
giống hệt nhau.

## B4. Commit nhỏ, `git log` kể thứ tự suy nghĩ

Một lỗi → một commit. Bài kiểm đỏ là **một commit riêng**. Mỗi bản vá tìm ra
lúc nghiệm thu là **một commit riêng**.

Ba việc ở phần A nên là **ba commit**, không gộp:

```
fix(openapi): sinh lai openapi.json — 56 -> 63 schema
fix(admin): khoi phuc xuong dong controller, chi giu 5 dong doi that
docs: giu lai bao cao M-01 ban dau, danh dau loi thoi
```

Thông điệp commit viết **tiếng Việt không dấu**, giải thích **vì sao**, và nêu
**số đo**. Ví dụ tốt có sẵn: `git log` của repo này.

Nếu một commit sắp vượt ~100 dòng hoặc chạm nhiều mối quan tâm → tách trước.

## B5. Comment tiếng Việt, giải thích **VÌ SAO**, không phải **CÁI GÌ**

Khi một dòng tồn tại để chặn một lỗi cụ thể, **kể lại chính cái bẫy đó kèm số
đo**. Mẫu đáng bắt chước:

- `src/common/request-id.middleware.ts` — bảng 4 con số đo tải, và hai lần đoán sai
- `src/common/cache.config.ts` — dual-package hazard, kể nguyên vẹn
- `src/catalog/sitemap/sitemap.service.ts` — vì sao chia lô theo id chứ không OFFSET

Nói thẳng khi có nợ kỹ thuật, kèm **điều kiện gỡ nó**.

## B6. Bài kiểm phải **chuyển được từ đỏ sang xanh**

Viết test xong thấy xanh thì **chưa đủ**. Phải cố tình làm hỏng đúng cái nó gác,
chạy lại, xác nhận nó **đỏ đúng số ca mong đợi**, rồi trả lại.

Bạn đã làm đúng việc này ở vòng 3 — giữ thói quen đó.

Lý do có luật này: bài kiểm đua R1/R4 ngày trước **chép lại trình tự SQL** thay
vì gọi `OrdersService`. Nó chứng minh được lỗi có thật, nhưng sửa mã xong nó vẫn
đỏ y nguyên — vì đang đo bản chép.

## B7. Bốn thứ không bao giờ tự quyết

| Không | Vì sao |
|---|---|
| Nâng `BASELINE` trong `scripts/check-lint.mjs` | bánh cóc **chỉ đi xuống**. Dọn được thì hạ xuống **đúng số đo được**; thêm lỗi thì sửa mã của mình |
| `git push` | push vào `staging` là **deploy ngay** ra `api-staging.zoldify.com`, và cần kiểm cổng 80/443 trên VPS trước |
| Sửa bất cứ gì trong `src/money/` | vai A (Đạt) giữ phần này. Viết test cho nó thì được |
| Xoá tài liệu cũ | giữ vết, đánh dấu lỗi thời thay vì xoá |

## B8. Dựng lại database test khi đổi nhánh

```bash
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "DROP DATABASE IF EXISTS zoldify_test; CREATE DATABASE zoldify_test
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Đã xảy ra: chạy test ở nhánh A tạo một index qua `synchronize: true`; sang nhánh
B không có index đó, synchronize đòi xoá, MySQL từ chối vì khoá ngoại → **48
test đỏ**, và suýt bị báo cáo thành "staging hỏng".

Và test phải chạy được **lần hai**: dùng dải id ngẫu nhiên mỗi lần chạy, đừng
đặt id cố định.

---

# C. Danh sách kiểm trước khi nói "xong"

Chạy từ trên xuống. Chỉ khi **tất cả** in ra `EXIT=0` thì mới viết báo cáo.

```bash
git status --short                                   # phải SẠCH
npm run build;            echo "build EXIT=$?"
npm test;                 echo "test EXIT=$?"        # ≥243
npm run lint:check;       echo "lint EXIT=$?"        # ≤910
npm run openapi:check;    echo "openapi EXIT=$?"     # 63 schema
npm run check:boot;       echo "boot EXIT=$?"
npm run check:audit;      echo "audit EXIT=$?"
npm run check:compose;    echo "compose EXIT=$?"
git diff e687e98 --stat -- src/ops/admin/admin.controller.ts   # ~8 dòng
```

Trong báo cáo, dán **đúng những dòng `EXIT=` đó**. Không diễn giải, không đoán
nguyên nhân cho cái nào khác 0 — nếu khác 0 thì nó **chưa xong**, và viết thẳng
là chưa xong kèm thông báo lỗi nguyên văn.

Một báo cáo nói "còn một cổng đỏ, đây là thông báo lỗi" **hữu ích hơn nhiều** so
với một báo cáo toàn ✅ mà người đọc phải đi đo lại. Lần này tôi đo lại ba vòng;
nếu không ai đo thì ba lỗi đó đã đi thẳng vào `staging`.
