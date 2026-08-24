# Báo cáo Task #4 — CI backend

**Người thực hiện:** Cường · **Ngày:** 2026-08-25 · **Nhánh:** `feat/epic-6-ci` → PR vào `staging`
**Trạng thái:** XONG (test-first; 6 cổng chạy xanh cục bộ; nghiệm thu cuối là CI xanh trên chính PR)

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
| R4 | TB | `diagrams:check` kéo Chromium qua mermaid-cli → hỏng/chậm trên runner sạch. | Tách job riêng, `continue-on-error`; giữ `drawio:check` (thuần JS) làm cổng chặn thật. | Cục bộ xanh 25 sơ đồ; vẫn giữ hedge cho runner |
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

## 6. Giới hạn (nói thẳng)

- Cổng lint **không** làm nợ lint giảm đi — nó chỉ chặn nợ tăng. 980 vấn đề vẫn nằm nguyên
  đó, cần một PR dọn riêng (bắt đầu bằng 462 lỗi prettier, tự sửa được).
- `diagrams:check` để `continue-on-error`: chạy để còn thấy, nhưng không chặn. Đây là **nợ
  có ý thức** — gỡ khi đã thấy nó xanh trên runner vài lần.
- Bài test ở mục 3 kiểm workflow **nói** đúng thứ cần nói. Việc workflow **chạy** được thật
  thì chỉ GitHub trả lời được. Nghiệm thu cuối cùng là nhìn CI xanh trên chính PR này.
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
