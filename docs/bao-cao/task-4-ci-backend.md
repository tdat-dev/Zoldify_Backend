# Báo cáo Task #4 — CI backend

**Người thực hiện:** Cường · **Ngày:** 2026-08-25 · **Nhánh:** `feat/epic-6-ci` → PR #11 → đã merge vào `staging` (`da70782`)
**Trạng thái:** XONG — **đã nghiệm thu thật trên GitHub Actions**, không còn phần nào chỉ xanh cục bộ. Số liệu ở mục 8.

## 1. Mục tiêu & bối cảnh

Task #4 bảng phân công (`docs/system-design/2026-08-08-phan-cong-4-nguoi.md`), hạn **11/08**,
tức đã quá hạn 2 tuần. Mục 4 của tài liệu xếp nó vào nhóm "việc trong 48 giờ tới" với lý do:
*"Chưa có CI nào. Không có CI thì không ai biết mình vừa làm hỏng cái gì."*

Repo trước đó chỉ có `deploy.yml` — chạy **sau khi đã merge** vào `staging`. Lúc biết mình
làm hỏng thì đã hỏng trên nhánh chung rồi. Việc thật của task này là dựng cổng chạy **trước**
khi merge, trên chính PR, để thứ hỏng còn nằm trong nhánh của người gây ra.

Mọi script cần gọi đã có sẵn trong `package.json` từ trước; thiếu đúng file YAML.

## 2. Pre-mortem — Rủi ro & lỗi ẩn dự đoán (TRƯỚC khi sửa)

| # | Mức | Rủi ro | Cách chặn | Kết quả |
|---|-----|--------|-----------|---------|
| R1 | **CAO** | `npm run lint` là `eslint --fix`. Trên runner nó **sửa file rồi vẫn thoát 0** → cổng lint thành trang trí, nợ lint không bao giờ lộ. | Script riêng không `--fix`; `selfcheck-ci.ts` đọc định nghĩa script và chặn nếu thấy `--fix`. | Đúng như dự đoán, đã chặn |
| R2 | **CAO** | 5 spec tiền chạy trên **MySQL thật** (`jest.config.js` để `maxWorkers: 1` chính vì chúng dùng chung `zoldify_test`). Runner sạch → `npm test` đỏ 100%. | Khai `services: mysql:8` + healthcheck, truyền `TEST_DB_*` khớp mặc định trong spec. | Đúng như dự đoán, đã chặn |
| R3 | **CAO** | `openapi:check` so `openapi.json` với bản sinh lại. Khác môi trường → CI **đỏ giả**. | Pin `node-version: '24'` khớp `deploy.yml`; `selfcheck-ci.ts` canh hai file không lệch nhau. | **Đỏ THẬT, không phải giả** — xem mục 5 |
| R4 | TB | `diagrams:check` kéo Chromium qua mermaid-cli → hỏng/chậm trên runner sạch. | Tách job riêng, `continue-on-error`; giữ `drawio:check` (thuần JS) làm cổng chặn thật. | Lo thừa — mermaid-cli **chạy xanh trên runner sạch** ngay lần đầu. Hedge chưa phải dùng tới |
| R5 | TB | Mốc boundaries: tài liệu ghi 29, code để 28. Đặt sai mốc là CI đỏ ngay hoặc mất tác dụng bánh cóc. | Đo lại cục bộ, **không sửa** `BASELINE` trong PR hạ tầng. | Số thật = **28**, khớp code. Tài liệu ghi 29 là số cũ |
| R6 | TB | Chạy trên mọi push của mọi nhánh → đốt phút Actions, trùng `deploy.yml`. | `on.pull_request` + `push` giới hạn `staging`/`main` + `concurrency` huỷ lần chạy cũ. | Đã làm |
| R7 | TB | `npm ci` đòi lock khớp `package.json`. | Kiểm cục bộ trước khi đẩy. | Đã kiểm |
| R8 | THẤP | Thêm cổng đỏ vào repo đang đỏ sẵn → cả nhóm quen nhìn dấu X rồi bỏ qua CI. | Chỉ bật cổng đã xanh cục bộ; cổng chưa xanh thì hedge + ghi nợ. | **Thành hiện thực ở cổng lint** — xem mục 4 |

**Rủi ro KHÔNG lường trước, phát hiện lúc làm:** line-ending. Máy dev là Windows với
`core.autocrlf=true`; nếu blob trong git là CRLF thì runner Linux sinh LF và `openapi:check`
đỏ vĩnh viễn. Đã kiểm: blob là **LF thuần** (8489 dòng), working copy CRLF, autocrlf lo phần
chuyển đổi → an toàn. Không cần `.gitattributes`.

## 3. Test viết TRƯỚC (đỏ → xanh)

`scripts/selfcheck-ci.ts` — theo khuôn `selfcheck*.ts` đã có, **không cần database**.

Vì sao cần, trong khi "CI tự nó đã là test": **một workflow hỏng không kêu, nó vẫn hiện dấu
tích xanh.** Bài test hỏi về *hợp đồng* của workflow, đọc từ chính file YAML:

1. `ci.yml` tồn tại và parse được thành YAML hợp lệ
2. Đủ 6 cổng theo bảng phân công
3. Mọi `npm run <x>` được gọi đều **có thật** trong `package.json` (chặn gõ nhầm tên script)
4. Cổng lint **không** dùng `--fix` (R1)
5. Job chạy `npm test` **phải** khai service mysql (R2)
6. `node-version` khớp `deploy.yml` (R3)
7. Có `on.pull_request`, `push` có giới hạn nhánh, có `concurrency` (R6)

**Chạy lần đầu → ĐỎ** ("ci.yml chưa tồn tại"). Sau khi viết workflow → **XANH**.

**Bài test bắt được lỗi trong chính nó:** regex ban đầu chỉ nhận `npm run <x>` nên báo
"THIẾU cổng test" trong khi workflow có chạy test — `npm test` là lối tắt có sẵn của npm.
Sửa bài test chứ không sửa workflow. Hàm nay nhận cả `npm run x`, `npm run-script x`,
và ba lối tắt `test`/`t`/`start`, nhưng **không** quét chung chung kiểu `npm <chữ>` để
`npm ci` không bị hiểu nhầm thành script tên "ci".

Đã đăng ký vào `scripts/selfcheck-all.ts`, đặt **đầu** danh sách vì là suite duy nhất không
cần database — hỏng cấu hình thì biết trong một giây, không phải đợi ba suite DB chạy xong.

## 4. Đã làm

- **`.github/workflows/ci.yml`** — 2 job:
  - `quality` (chặn merge): lint · boundaries · build · openapi:check · test · tự kiểm CI.
    Có `services: mysql:8` với healthcheck, `TEST_DB_*` trỏ vào đó.
  - `diagrams` (tách riêng): `drawio:check` chặn thật, `diagrams:check` không chặn.
- **`scripts/check-lint.mjs`** — **bánh cóc nợ lint**, cùng ý với `check-boundaries.mjs`.
- **`scripts/selfcheck-ci.ts`** — bài test ở mục 3.
- **`package.json`** — thêm `lint:check` (gọi bánh cóc) và `check:ci`; thêm `js-yaml`
  vào devDependencies (bài test cần đọc cấu trúc YAML thật, không đoán bằng regex dòng).
- **`scripts/selfcheck-all.ts`** — thêm suite CI.

### Vì sao cổng lint là bánh cóc chứ không chặn thẳng

Đo được: **1008 vấn đề (943 lỗi + 65 cảnh báo) trên 120 file**. Trong đó 462 là
`prettier/prettier` — thuần định dạng.

Ba lối đi và lý do loại hai:

- *Chặn thẳng bằng `eslint` trần* → CI đỏ từ commit đầu và đỏ mãi. Một CI đỏ vĩnh viễn còn
  tệ hơn không có CI: cả nhóm học được cách nhìn dấu X rồi bấm merge. `deploy.yml:33` đã
  gặp đúng bài này và chọn `continue-on-error`.
- *Chạy `--fix` trong CI* → xanh giả (R1). Còn `--fix` rồi commit ngược lại là một diff chạm
  120 file — việc phải làm bằng PR riêng, cố ý, không phải tác dụng phụ của việc dựng CI.
- *Đếm và không cho tăng* ← chọn cái này.

Mốc: **980** (không tính `boundaries/*` vì món đó đã có mốc riêng — đếm hai nơi thì sửa một
vi phạm phải hạ hai mốc, và mốc nào cũng nói dối một nửa).

## 5. Kết quả từng cổng (chạy cục bộ)

| Cổng | Lệnh | Kết quả |
|------|------|---------|
| lint | `npm run lint:check` | ✅ 980 / mốc 980 |
| boundaries | `npm run boundaries:check` | ✅ 28 / mốc 28 |
| build | `npm run build` | ✅ |
| openapi | `npm run openapi:check` | ❌ → ✅ sau khi sinh lại hợp đồng (xem dưới) |
| test | `npm test` | ✅ **8/8 suite, 52 test** (18,6s) trên MySQL thật |
| sơ đồ | `npm run drawio:check` · `npm run diagrams:check` | ✅ 1 file .drawio · 25 sơ đồ mermaid |
| tự kiểm CI | `npm run check:ci` | ✅ |

### Cổng openapi bắt được lỗi thật ngay ngày đầu

`openapi.json` trong git đã lệch code từ trước. Bỏ qua cả khoảng trắng vẫn còn **1310 dòng
lệch nội dung**: 6 route và 1 schema chưa được ghi, `Category` thiếu `name_en`, `Shop` /
`CreateShopDto` / `UpdateShopDto` thiếu 8 trường `pickup_*`. Nghĩa là web và mobile đang
sinh client từ hợp đồng cũ.

Đây đúng là việc mục 3 tài liệu phân công giao cho `openapi:check` làm: *"ai đổi API mà quên
sinh lại thì CI đỏ"*.

Xử lý bằng **PR riêng** (`fix/openapi-contract-drift`) chứ không nhét vào PR này — cùng tài
liệu ghi *"Sửa hợp đồng phải báo trước… Nhắn nhóm trước khi merge"*, và một diff 1756 dòng
vào file hợp đồng chung mà nằm lẫn trong PR "thêm CI" thì người duyệt sẽ lướt qua.

**Thứ tự merge: PR hợp đồng trước, PR CI sau.**

*Đã thực hiện đúng thứ tự đó.* PR #10 (hợp đồng) merge lúc 19:44, PR #11 (CI) merge lúc 20:41.
Mục 8 ghi lại bằng chứng cho thấy thứ tự này không phải cẩn thận thừa.

## 6. Giới hạn (nói thẳng)

- Cổng lint **không** làm nợ lint giảm đi — nó chỉ chặn nợ tăng. 980 vấn đề vẫn nằm nguyên
  đó, cần một PR dọn riêng (bắt đầu bằng 462 lỗi prettier, tự sửa được).
- `diagrams:check` vẫn để `continue-on-error`. Nó đã xanh trên runner **2 lần liên tiếp**, nên
  điều kiện gỡ hedge ("xanh vài lần") gần đạt — nhưng chưa gỡ trong PR này, để mốc quyết định
  nằm ở người đọc con số chứ không ở người viết workflow.
- ~~Việc workflow **chạy** được thật thì chỉ GitHub trả lời được.~~ **GitHub đã trả lời** —
  xem mục 8. Giữ lại dòng gạch để thấy giới hạn này từng có thật và đã được gỡ, không phải
  bị lặng lẽ xoá đi.
- Chưa bật `openapi:check` cho nhánh `main` riêng biệt — `push` giới hạn `staging`/`main`
  dùng chung một job.
- Cổng test chạy trên container `zoldify-test-mysql` dựng đúng theo hướng dẫn trong
  `ledger.service.spec.ts`. **Chưa chạy `npm run check`** (3 suite Epic 0–4) vì chúng cần
  database `zoldify` đã seed 1 triệu bản ghi, không phải `zoldify_test` rỗng — PR này không
  đụng gì tới đường dữ liệu nên không có lý do làm chúng đổi kết quả.

## 7. Đính chính hai chỗ trong tài liệu cũ

- `2026-08-08-phan-cong-4-nguoi.md` ghi mốc boundaries là **29**; số thật trong
  `scripts/check-boundaries.mjs` và đo lại đều là **28**.
- `epic-5-infra-erd.md` ghi "không có Docker cục bộ" nên phần Redis trong compose mới là
  *config-verified*. Máy hiện **có Docker 29.7.2** — phần đó nghiệm thu thật được rồi.

## 8. Nghiệm thu thật trên GitHub Actions

Mục này thay cho dòng "nghiệm thu cuối là CI xanh trên chính PR" ở các bản trước. CI đã chạy,
đây là số nó trả về.

### 8.1. Lần chạy đầu — ĐỎ, và đỏ đúng chỗ đã dự đoán

Run `32772475120`, ~1 phút 53. Job `quality` dừng ở cổng 4:

| Cổng | Kết quả |
|---|---|
| Nợ lint không tăng | xanh |
| Ranh giới nghiệp vụ | xanh |
| Build | xanh |
| **OpenAPI khớp code** | **ĐỎ** |
| Test · Tự kiểm hợp đồng CI | bỏ qua (cổng trước đỏ) |

Job `Sơ đồ` xanh hoàn toàn.

**Đây là bằng chứng mạnh nhất trong cả task**, nên ghi kỹ. Dòng `git diff` trên runner:

```
diff --git a/openapi.json b/openapi.json
index 24700ca..d6b1780
```

- `24700ca` — blob `openapi.json` đang nằm trong `staging` lúc đó (87 route)
- `d6b1780` — blob runner **tự sinh lại được** (93 route)

Và `d6b1780` **trùng khít từng byte** với `openapi.json` trong PR #10. Tức bản vá hợp đồng
mà con người viết ra chính xác là thứ runner Linux tự sinh.

Ý nghĩa: **R3 bị loại trừ bằng bằng chứng, không phải bằng lập luận.** Nỗi lo "đỏ giả do khác
môi trường" là có cơ sở, nhưng ở đây đỏ này là đỏ THẬT. Việc pin `node-version: '24'` khớp
`deploy.yml` đã ăn tiền.

Một chi tiết dễ đọc nhầm: diff hiện **37 dòng thêm / 31 dòng xoá** cho các khoá `/api/...`.
Con số đó **không** phải "37 route bị thiếu" — phần lớn là sắp xếp lại thứ tự khoá. Chênh
lệch thật là 93 − 87 = **6 route**, khớp đúng thông điệp commit của PR #10.

### 8.2. Lần chạy sau — XANH đủ 6 cổng

Sau khi merge PR #10 rồi đồng bộ `staging` vào nhánh này, run `32773212858` xanh toàn bộ:

| Cổng | Số đo thật trên runner |
|---|---|
| Nợ lint không tăng | 980 vấn đề, không tăng |
| Ranh giới nghiệp vụ | **28 vi phạm / mốc 28** |
| Build | xanh |
| OpenAPI khớp code | 93 route, không lệch |
| Test | **8 suite, 52 test pass**, 6.079s |
| Tự kiểm hợp đồng CI | R1 · R2 · R3 · R6 đều pass |
| *Sơ đồ (không chặn)* | 20 file `.drawio` + mermaid, xanh |

Vài điều chỉ lần chạy thật mới nói được:

- **Cổng test không xanh rỗng.** 52 test chạy thật trên container MySQL 8, gồm cả 5 spec tiền
  vốn cần database. Đáng kiểm riêng, vì một cổng chạy 0 test cũng hiện dấu tick y hệt cổng
  chạy 52 test — đây đúng là kiểu hỏng mà mục 3 nói: *workflow hỏng không kêu*.
- **Mốc boundaries = 28 được xác nhận trên Linux**, không chỉ trên máy Windows. Củng cố phần
  đính chính ở mục 7.
- **R2 và R7 chặn thành công**: `Initialize containers` và `npm ci` đều xanh, không có đỏ giả
  nào từ hạ tầng.

### 8.3. Sau khi merge vào `staging`

Merge PR #11 (`da70782`) kích hoạt đồng thời hai workflow trên `staging`, **cả hai xanh**:

- `CI` (run `32775291725`) — 6 cổng chạy lần đầu trên nhánh chung
- `Deploy Backend` (run `32775291730`) — workflow cũ **không** bị workflow mới làm hỏng

Điều cuối này đáng nói riêng: thêm một workflow vào repo có thể làm hỏng workflow sẵn có qua
tranh chấp `concurrency` hoặc trùng trigger. Đã kiểm, không xảy ra.

### 8.4. Hệ quả cho cả nhóm

Từ `da70782` trở đi, **mọi PR vào `staging` và `main` đều bị 6 cổng chặn**. Đây là thay đổi
ảnh hưởng cả 4 người chứ không riêng người viết CI — cần nhắn nhóm, để người mở PR tiếp theo
không ngạc nhiên khi bị chặn.

Món nợ lint 980 vấn đề vẫn nguyên. Nhắc lại cho người nhận PR dọn nợ: 462 lỗi `prettier/prettier`
là tự sửa được, sau đó tới `no-unsafe-member-access` (212), `no-unsafe-assignment` (155),
`no-unused-vars` (50), `no-unsafe-argument` (32).
