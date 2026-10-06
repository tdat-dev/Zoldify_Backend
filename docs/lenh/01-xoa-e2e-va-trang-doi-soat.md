# Lệnh 01 — xoá `test:e2e`, và trang đối soát sổ cái (task #35)

**Gửi:** OpenCode · **Người ra lệnh:** vai B (Cường) · **Ngày:** 06/10/2026
**Nền:** `82abb78` · nhánh `master`
**Đọc trước:** `docs/lenh/README.md`, và phần B của `huong-dan-va-viec-con-lai-M01.md`

---

## Trạng thái lúc giao

```
npm run nghiem-thu  →  ĐẠT, bảy cổng EXIT 0, cây sạch
36/36 suite · 246/246 test · nợ lint 507 (mốc 507) · 102 route · 64 schema
```

Mọi số ở trên là mốc. **Sau khi làm xong, không cổng nào được tệ đi.**

Hai việc trong lệnh này **không liên quan nhau**. Làm xong việc A rồi hãy sang
việc B — đừng trộn, vì mỗi việc có một chuỗi commit riêng.

---

# VIỆC A — xoá `test:e2e` (3 bước)

## Quyết định đã có, không cần cân nhắc lại

Tôi đã đo và quyết: **xoá**. Lý do, để bạn hiểu chứ không phải để bàn lại:

1. `test/app.e2e-spec.ts` là **file mẫu mặc định của NestJS**, 29 dòng, khẳng
   định đúng một việc: `GET /` trả `'Hello World!'`.
2. Nó **chưa bao giờ chạy được**. Tôi chạy thử:

   ```
   npm run test:e2e
   → Cannot find module '@ops/settings/settings.service'
     from '../src/common/guards/maintenance.guard.ts'
   Test Suites: 1 failed, 1 total ; Tests: 0 total ; EXIT=1
   ```

   Nguyên nhân: `test/jest-e2e.json` **không có `moduleNameMapper`**, nên alias
   `@ops/...` không phân giải được. `jest.config.js` của bộ test chính thì có —
   nó đọc `paths` thẳng từ `tsconfig.json`.
3. Kể cả sửa được config, thứ nó khẳng định là **tập con hẹp hơn hẳn**
   `check:boot`: cổng đó có 19 mục, gồm cả `GET /`, `/health`, sitemap, request-id,
   và 401 cho route cần token.

Giữ một file mẫu chưa từng chạy, khẳng định ít hơn cổng đã có, là nợ chứ không
phải lưới an toàn. Comment trong `ci.yml` đã viết sẵn câu đó: *"một cái chốt
không chạy thì không phải là chốt"*.

---

## Bước A1 — xoá ba thứ

**Sửa:**

```bash
git rm test/app.e2e-spec.ts test/jest-e2e.json
```

Và bỏ dòng này khỏi `package.json` (dòng 22):

```json
"test:e2e": "jest --config ./test/jest-e2e.json",
```

**Nghiệm thu:**

```bash
grep -rn "test:e2e" package.json; echo "EXIT=$?"   # EXIT=1 nghĩa là không còn
npm run build; echo "EXIT=$?"                      # EXIT=0
ls test 2>/dev/null; echo "thu muc test: $?"       # thư mục rỗng hoặc không còn
```

**Commit:**

```
chore: xoa test:e2e — file mau NestJS chua bao giờ chay duoc

test/app.e2e-spec.ts la file mau mac dinh cua NestJS, 29 dong, khang dinh dung
mot viec: GET / tra 'Hello World!'.

No CHUA BAO GIO chay duoc. Do ngay 06/10:
  npm run test:e2e
  -> Cannot find module '@ops/settings/settings.service'
     Test Suites: 1 failed ; Tests: 0 total ; EXIT=1
Nguyen nhan: test/jest-e2e.json khong co moduleNameMapper nen alias @ops/...
khong phan giai duoc. jest.config.js cua bo test chinh thi co, no doc paths
thang tu tsconfig.json.

Ke ca sua duoc config thi thu no khang dinh van la tap con hep hon han
check:boot — cong do co 19 muc, gom ca GET /, /health, sitemap, request-id va
401 cho route can token.

Giu mot file mau chua tung chay, khang dinh it hon cong da co, la no chu khong
phai luoi an toan.
```

---

## Bước A2 — sửa comment trong `ci.yml`

`.github/workflows/ci.yml` quanh dòng 215 còn nhắc tới file vừa xoá:

```
# `test/app.e2e-spec.ts` có dựng AppModule thật, nhưng nó chạy bằng
# `npm run test:e2e` mà CI chưa bao giờ gọi. Một cái chốt không chạy thì
# không phải là chốt — đúng chuyện đã xảy ra với check:index.
```

**Sửa:** viết lại ba dòng đó cho đúng sự thật mới. Nội dung phải có:

- file đó **đã xoá** ngày 06/10, kèm lý do một câu (chưa bao giờ chạy được vì
  thiếu `moduleNameMapper`)
- `check:boot` là thứ thay thế, và nó **mạnh hơn**
- **điều kiện để dựng lại e2e**: khi cần kiểm một luồng nhiều bước qua HTTP thật
  (đăng nhập → đặt đơn → thanh toán → giao hàng) mà `check:boot` không phủ

Câu cuối quan trọng: nói thẳng khi có nợ kỹ thuật thì phải kèm **điều kiện gỡ
nó** — xem `CLAUDE.md` mục comment.

**Nghiệm thu:**

```bash
grep -rn "test:e2e\|app.e2e-spec" .github/ ; echo "EXIT=$?"   # chỉ còn trong comment mới
```

**Commit:** `docs(ci): comment con nhac test:e2e da xoa — viet lai kem dieu kien dung lai`

---

# VIỆC B — task #35, trang đối soát sổ cái (6 bước)

## Một chỗ trong kế hoạch cũ nói sai, đừng làm theo

`ke-hoach-ban-giao-backend.md` ghi task #35 có thể dùng *"kết quả job đối soát
(task #32 của Đạt)"*. Tôi tìm lại: **job đó không tồn tại**.

```
grep -rniE "doi.?soat|reconcil" --include=*.ts src/ scripts/ | grep -v spec
→ chỉ có orders.service.ts:985 reconcileOrderDelivered — việc của MỘT đơn, không phải job đối soát sổ cái
```

Nên trang này **tự tính đối soát tại chỗ**, không đọc kết quả của ai. Thực ra
như vậy tốt hơn: nó kiểm bất biến ngay lúc admin mở trang, chứ không hiển thị
một con số đã cũ một tiếng.

## Đối soát nghĩa là kiểm hai bất biến

| # | Bất biến | Vì sao |
|---|---|---|
| 1 | `SUM(amount)` của **toàn bộ** `ledger_entries` = 0 | Mỗi giao dịch có ≥2 bút toán tổng bằng 0 (`LedgerService.validateInput`). Nên tổng toàn hệ phải bằng 0. Khác 0 = tiền tự sinh ra hoặc biến mất |
| 2 | Với **mỗi** tài khoản: `ledger_accounts.balance` = `SUM(amount)` các bút toán của nó | `balance` là số được cache lại cho nhanh. Lệch nghĩa là có đường ghi nào đó sửa `balance` mà không ghi bút toán — đúng loại lỗi làm sổ cái mất giá trị |

Hai câu SQL dưới đây **dùng nguyên văn**, đừng tự viết lại:

```sql
-- Bất biến 1
SELECT COALESCE(SUM(amount), 0) AS tong FROM ledger_entries;

-- Bất biến 2 — chỉ trả về tài khoản LỆCH
SELECT a.id, a.owner_type, a.owner_id, a.purpose, a.balance,
       COALESCE(SUM(e.amount), 0) AS tong_but_toan
FROM ledger_accounts a
LEFT JOIN ledger_entries e ON e.account_id = a.id
GROUP BY a.id, a.owner_type, a.owner_id, a.purpose, a.balance
HAVING a.balance <> COALESCE(SUM(e.amount), 0);
```

## Bẫy phải biết trước: `bigint` không đi qua JSON được

Tiền lưu bằng `BIGINT` đơn vị đồng, và trong mã là `bigint` của JS — xem
`src/money/ledger/ledger.types.ts` đầu file: *"`Number()` của JS mất chính xác
với số lớn mà không báo lỗi gì"*.

`JSON.stringify(1n)` **ném `TypeError: Do not know how to serialize a BigInt`**.
Nên mọi số tiền trong response phải là **chuỗi**, không phải `number`:

```ts
tong_but_toan: '0'          // ĐÚNG
tong_but_toan: 0            // SAI — mất chính xác với số lớn
```

---

## Bước B1 — viết bài kiểm, và xác nhận nó ĐỎ

**Đây là bước hay bị làm hình thức nhất.** Viết trước, chạy, **nhìn thấy nó đỏ**,
rồi mới viết mã. Một bài kiểm không chuyển được từ đỏ sang xanh thì không nghiệm
thu được gì.

File mới: `src/ops/admin/ledger-doi-soat.service.spec.ts`

**Chạy trên MySQL thật**, không mock. Chép khuôn dựng `DataSource` từ
`src/money/ledger/ledger.service.spec.ts` — bất biến ở đây do **database** giữ,
mock đi thì bài kiểm xanh mà không chứng minh gì.

Bốn ca:

| # | Dựng | Kỳ vọng |
|---|---|---|
| 1 | sổ cái rỗng | `tong_but_toan === '0'`, `can_bang === true`, `so_tai_khoan_lech === 0` |
| 2 | một giao dịch hợp lệ hai chân (dùng `LedgerService.post`) | vẫn `can_bang === true`, `so_tai_khoan_lech === 0` |
| 3 | **phá có chủ đích**: `UPDATE ledger_accounts SET balance = balance + 1000 WHERE id = ?` | `so_tai_khoan_lech === 1`, và tài khoản đó có `lech === '1000'` |
| 4 | nạp tiền vào `platform/escrow_hold` | `tong_dang_giu_ho` đúng bằng số đó, dạng **chuỗi** |

Ca 3 chính là ca đối chứng nằm sẵn trong bài kiểm: nó chứng minh bộ dò **dò
được**. Một bộ đối soát luôn báo "cân" thì vô dụng.

Dùng dải id ngẫu nhiên mỗi lượt chạy (`9_000_000 + Math.floor(Math.random() * 1_000_000)`)
— bài kiểm phải chạy được **lần hai**.

**Nghiệm thu bước này:**

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root \
TEST_DB_PASSWORD=testpw TEST_DB_NAME=zoldify_test \
npx jest src/ops/admin/ledger-doi-soat.service.spec.ts; echo "EXIT=$?"
```

Phải **EXIT=1**, và lỗi phải là *không tìm thấy module/hàm* — chứ không phải lỗi
cú pháp hay fixture. Nếu cả bốn ca đỏ giống hệt nhau thì nghi **fixture** trước,
nghi mã sau (đã xảy ra: thiếu cột `NOT NULL` làm cả 8 ca đỏ y hệt).

**Commit:** `test(doi-soat): 4 ca cho trang doi soat so cai, dang DO`

---

## Bước B2 — viết service cho bài kiểm xanh

File mới: `src/ops/admin/ledger-doi-soat.service.ts`

Chỉ đọc, không ghi. Tiêm `DataSource`, chạy đúng hai câu SQL ở trên.

Hình dạng trả về — **dùng đúng tên khoá này**, vì openapi và frontend đi theo nó:

```ts
{
  can_bang: boolean,              // tong_but_toan === '0'
  tong_but_toan: string,          // bất biến 1
  tong_dang_giu_ho: string,       // số dư platform/escrow_hold
  so_du_he_thong: Array<{         // mọi tài khoản platform + external
    owner_type: string,
    purpose: string,
    balance: string,
  }>,
  so_tai_khoan_lech: number,      // ĐẾM THẬT, không phải độ dài mảng dưới
  tai_khoan_lech: Array<{         // tối đa 100 dòng
    id: number,
    owner_type: string,
    owner_id: number | null,
    purpose: string,
    balance: string,
    tong_but_toan: string,
    lech: string,
  }>,
}
```

Hai điểm bắt buộc:

- **`so_tai_khoan_lech` là số đếm thật**, còn `tai_khoan_lech` cắt ở **100** dòng.
  Theo khuôn `TRAN_MOI_TRANG = 100` trong `admin-audit.service.ts`. Lý do: nếu sổ
  cái hỏng diện rộng thì mảng kia có thể hàng nghìn dòng, mà con số admin cần
  thấy ngay là **có bao nhiêu**. Ghi hằng số thành `const` có tên, kèm comment
  nói vì sao 100.
- Mọi số tiền là **chuỗi** (xem bẫy bigint ở trên).

Comment tiếng Việt giải thích **VÌ SAO**, không phải cái gì. Mẫu đáng chép:
`src/ops/admin/admin-audit.service.ts`.

Đăng ký service trong `src/ops/admin/admin.module.ts`.

**Nghiệm thu:**

```bash
npm run build; echo "EXIT=$?"      # EXIT=0
npx jest src/ops/admin/ledger-doi-soat.service.spec.ts; echo "EXIT=$?"   # EXIT=0, 4/4
```

**Commit:** `feat(doi-soat): service kiem hai bat bien so cai — 4 ca tu DO sang XANH`

---

## Bước B3 — route admin

Thêm vào `src/ops/admin/admin.controller.ts`:

```
GET /admin/ledger/doi-soat
```

Chép khuôn từ `getAuditLogs` ngay trong file đó: lớp đã có
`@UseGuards(JwtAuthGuard, AdminGuard)` nên **không thêm guard ở method**.

Cần `@ResponseMessage(...)` và một decorator mô tả hình dạng cho openapi — xem
`ApiShape` trong `src/common/decorators/api-response.decorator.ts`, đang được
dùng ở `wallets.controller.ts:51`.

Route này là **GET**, nên nó **không** tự ghi vào nhật ký admin — đúng như
`getAuditLogs`, và vì lý do ghi sẵn trong comment của route đó.

**Nghiệm thu:**

```bash
npm run build;         echo "EXIT=$?"
npm run check:boot;    echo "EXIT=$?"
npm run openapi:gen && git add openapi.json
npm run openapi:check; echo "EXIT=$?"      # EXIT=0, và số route phải là 103
```

> `openapi:check` = `openapi:gen && git diff --exit-code openapi.json`, tức nó so
> cây làm việc với **index** — nó hỏi *"file đã vào git chưa"*. Quên `git add` là
> nó đỏ. Cổng này đã đỏ bốn lần vì đúng lý do đó.

**Commit:** `feat(doi-soat): route GET /admin/ledger/doi-soat` + một commit riêng cho `openapi.json`

---

## Bước B4 — ca đối chứng ở tầng route

Ca 3 của bài kiểm đã chứng minh **service** dò được lệch. Bước này chứng minh
**route** thật sự gọi tới service đó — hai chuyện khác nhau, và đã có lần "spec
xanh mà app không dựng nổi".

Làm tay, ghi lại lệnh và kết quả vào báo cáo:

1. Dựng app (`npm run start:dev`), ký token admin, gọi `GET /admin/ledger/doi-soat`
   → `can_bang: true`.
2. `UPDATE ledger_accounts SET balance = balance + 1000 WHERE id = <một id>;`
3. Gọi lại → `can_bang: false`, `so_tai_khoan_lech: 1`.
4. `UPDATE ... SET balance = balance - 1000 WHERE id = <id đó>;` → trả lại.

**Chạy trên `zoldify_test`, không phải DB dev.** Bước 2 sửa thẳng số dư trong
bảng tiền — làm nhầm database là để lại dữ liệu hỏng trong sổ cái thật.

**Commit:** `docs(doi-soat): ca doi chung o tang route — pha so du roi tra lai`

---

## Bước B5 — báo cáo

File mới: `docs/bao-cao/task-35-trang-doi-soat.md`

Theo khuôn `docs/bao-cao/task-34-nhat-ky-admin.md`. Phải có:

- hai bất biến và **vì sao** chính là hai cái đó
- hai câu SQL, kèm `EXPLAIN` của câu thứ hai (nó có `GROUP BY` trên
  `ledger_accounts` — ghi lại số đo, đừng đoán nó nhanh hay chậm)
- bẫy bigint–JSON
- kết quả ca đối chứng ở bước B4, nguyên văn
- việc chưa làm: giao diện admin, và **không có job chạy định kỳ** — đối soát chỉ
  chạy khi admin mở trang

---

## Bước B6 — nghiệm thu

```bash
git status --short            # phải SẠCH
npm run nghiem-thu; echo "EXIT=$?"
```

Nộp `nghiem-thu.md` kèm `git log --oneline -12`. **Không nộp văn xuôi.**

Mốc không được tệ đi:

| | Trước | Sau phải là |
|---|---|---|
| suite / test | 36 / 246 | **37 / ≥250** (thêm file spec mới, 4 ca) |
| nợ lint | 507 | **≤ 507** |
| route openapi | 102 | **103** |
| bảy cổng | EXIT 0 | EXIT 0 |

Nếu nợ lint tăng: **sửa mã của mình**, không nâng `BASELINE`. Nếu đo được thấp
hơn 507 thì hạ mốc xuống **đúng số đo được** và nói số đó trong commit.

---

## Không tự quyết

| Không | Vì sao |
|---|---|
| Sửa bất cứ gì trong `src/money/` | vai A (Đạt) giữ. Lệnh này chỉ **đọc** sổ cái. Viết bài kiểm thì được |
| Sửa `src/ordering/` | như trên |
| `eslint --fix` ngoài các file bạn vừa tạo/sửa | lần trước chạy toàn repo, định dạng lại 73 file, 11 file thuộc `src/money/`. **Liệt kê file không phải là cấm, nên đây là cấm tường minh**: chỉ `--fix` đúng những file có tên trong `git status` của bạn |
| Nâng `BASELINE` lint | bánh cóc chỉ đi xuống |
| Sửa `.env` | cấu hình máy thật, tôi quyết |
| `git push` | push `staging` là deploy ngay ra `api-staging.zoldify.com` |
| `rm -rf .git`, `git init` lại, `reset --hard`, `gc --prune` | lịch sử cục bộ đã mất một lần hôm 05/10 và **không phục hồi được** — cả hai bản chụp VSS đều hỏng, và không nhánh nào của ta từng được push |
| Xoá tài liệu cũ | giữ vết, đánh dấu lỗi thời thay vì xoá |

## Khi nào DỪNG và hỏi

- Bài kiểm bước B1 **không chịu đỏ** → dừng. Nó đang đo nhầm thứ.
- Hai câu SQL trả kết quả khác điều lệnh này mô tả → dừng, báo số đo. Có thể sổ
  cái đang lệch thật, và đó là phát hiện chứ không phải lỗi của bạn.
- Bất kỳ cổng nào đỏ mà bạn không rút ra được nguyên nhân trong hai lần thử →
  dừng, dán nguyên văn lỗi. **Đừng đoán nguyên nhân.** Ba lần đoán trước đều sai:
  "nợ lint cũ", "lỗi tsconfig", "vấn đề credential có sẵn" — cả ba đều không phải.
