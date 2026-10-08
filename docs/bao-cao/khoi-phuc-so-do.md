# Khôi phục 18 sơ đồ nguồn, và ba báo động giả của bộ kiểm

**Vai:** B — Platform · DevOps · Backend nghiệp vụ
**Làm ngày:** 29/09/2026 · **Nhánh:** `docs/khoi-phuc-so-do` (tách từ `staging`)
**Bài kiểm:** `npm run drawio:check`

---

## 1. Vì sao việc này gấp

`docs/BAN-GIAO.md` ghi một dòng: *"`drawio:check` xanh giả — mất 19/20 sơ đồ;
commit `839e3df`"*. Con số thật đo được hôm nay là **18/20**.

Nó gấp vì báo cáo. Thầy dặn hai điều chạm thẳng vào đây:

> **#18** — *"Đối các sơ đồ trong bài thuyết trình các thầy cô sẽ hỏi rất kỹ."*
> **#19** — *"Các sơ đồ phải export ra ảnh không được chụp màn hình, vì đến khi
> zoom lên sẽ bị vỡ."*

Không có file nguồn thì không sửa được sơ đồ, và không export lại được ảnh —
chỉ còn nước chụp màn hình, đúng thứ thầy cấm.

---

## 2. Chuyện đã xảy ra — và `BAN-GIAO.md` kể sai chuyện này

`docs/BAN-GIAO.md` ghi: *"`drawio:check` xanh giả — **mất 19/20 sơ đồ**"*.

**Không có sơ đồ nào bị mất.** Mở file ra kiểm mới biết.

Commit `839e3df` (24/08, Nguyễn Huy, *"docs: add system use-case diagram"*) thêm
2441 dòng cho `05-use-case-diagram.drawio` và xoá 17 file `.drawio` khác trong
cùng một commit. Nhưng cái tên `05-use-case-diagram` đánh lừa: file đó **không
phải một sơ đồ**, nó là **file 20 trang chứa cả 20 sơ đồ**:

```
Use Case Diagram · Activity ×7 · Class Diagram · Sequence Diagram ·
ERD · Deployment Diagram · System Context · Container · Component ·
Fund Flow · State Machine ×2 · Screen Navigation · Deployment Pipeline
```

Tức là Huy **gộp** 20 sơ đồ vào một file để mở trong draw.io cho tiện — đúng
cách người ta thường làm — chứ không xoá mất gì.

### Nhưng file gộp đó nay đã cũ, và nó không tự sinh lại

Đối chiếu nội dung trang *Deployment* trong file gộp với thực tế hôm nay:

| File gộp (ảnh chụp 24/08) | Sự thật |
|---|---|
| `Node.js 20` | Dockerfile dùng `node:24-bookworm-slim` |
| `max_connections 200` | compose không đặt biến đó; app đặt `connectionLimit 15` |
| `Admin workstation (planned)`, tô đỏ | `admin.zoldify.com` trả HTTP 200 |
| `push to GHCR` | `deploy.yml` không đẩy ảnh lên registry nào |

Nó là **ảnh chụp đông cứng**: `make-drawio.mjs` không ghi vào nó, `drawio:shoot`
chỉ render **trang đầu** của một file nhiều trang. Nên 19 trang còn lại nằm
trong đó mà không ai render, không ai cập nhật.

### Cái bẫy thật, và bộ kiểm vẫn mù

`drawio:check` duyệt *những file đang có* — cái đang thiếu thì vòng lặp không
bao giờ chạm tới. Nên nó báo "3 file hợp lệ, 0 lỗi" trong khi 18 file mà bộ
sinh khai đã không còn. Đây đúng loại lỗi mà `BAN-GIAO.md` mục 7 đã kể một lần
với `check:boot`: một cái chốt không kiểm đúng thứ cần kiểm thì cũng như không
có chốt.

> **Bài học lặp lại.** `CLAUDE.md` dặn mở file kiểm từng luận điểm trước khi
> nhận việc, vì review của agent khác *"nghe rất đúng"*. Lần này câu sai đến từ
> chính tài liệu bàn giao của nhóm. Tôi đã kiểm **số lượng** file rồi mới kiểm
> **nội dung** — đúng ra phải ngược lại.

---

## 3. Trước khi khôi phục: 594 "lỗi" hoá ra là báo động giả

`npm run drawio:check` lúc bắt đầu báo **594 lỗi**, toàn bộ trên
`Sequence-Diagrams.drawio` — một file 14 trang vẽ tay bằng mermaid trong draw.io.

Phản xạ sai ở đây là đi sửa file cho hết lỗi. Mở ra kiểm từng luận điểm thì cả
ba loại đều là **bộ kiểm sai**:

| Lỗi báo | Số | Sự thật |
|---|---:|---|
| `parent="…" trỏ vào id không tồn tại` | ~560 | Id **có thật**, nằm trên thẻ `<UserObject label="" mermaidData="…" id="…">`. Bộ kiểm gom id bằng `<mxCell id="` — đòi `id` phải là thuộc tính **đầu tiên** và phải trên thẻ `mxCell`. draw.io bọc mọi hình sinh từ mermaid trong `<UserObject>` và xếp thuộc tính theo bảng chữ cái. Đếm được: file có **452** thẻ `<mxCell` mà bản cũ chỉ nhìn thấy **153** |
| `shape=line không nằm trong danh sách` | ~30 | `line` là shape dựng sẵn thật của draw.io, chỉ thiếu trong `KNOWN_SHAPES` |
| `dấu & chưa escape` | 42 | Cả 42 là `&#xa;` — tham chiếu ký tự **hệ thập lục**, hợp lệ theo chuẩn XML. Regex cũ chỉ nhận `#\d+;` tức hệ thập phân |

Sau khi sửa bộ kiểm: **594 → 0**, và file sơ đồ **không bị động một ký tự**.

> Một bộ kiểm báo sai hàng loạt cũng vô dụng ngang bộ kiểm luôn xanh: cả nhóm
> học cách bỏ qua nó, rồi lỗi thật đi lọt cùng đám lỗi giả.

**Ca đối chứng đã chạy** trước khi tin vào ba sửa đổi trên: cố tình đổi một
`parent="1"` thành id không tồn tại → bộ kiểm **vẫn báo đỏ**. Nới ba chỗ đó
không làm nó thành luôn xanh.

---

## 4. Bài kiểm mới: đếm đủ số sơ đồ

Đây là lỗi thật mà bộ kiểm chưa bao giờ thấy. Danh sách sơ đồ **lấy từ chính
`scripts/make-drawio.mjs`**, không chép tay — chép tay thì thêm sơ đồ mới vào bộ
sinh mà quên cập nhật ở đây là bộ kiểm lại mù tiếp.

```
Bộ sinh khai 20 sơ đồ · thư mục có 3 file · thiếu 18     ← ĐỎ
Bộ sinh khai 20 sơ đồ · thư mục có 21 file · không thiếu ← XANH
```

---

## 5. Khôi phục

```bash
node scripts/make-drawio.mjs        # KHÔNG --force
→ 18 file mới, 2 file giữ nguyên
```

**Bằng chứng không đụng vào bản vẽ tay.** Md5 ba file đang có, trước và sau khi
chạy bộ sinh, giống hệt:

| File | md5 |
|---|---|
| `05-use-case-diagram.drawio` (Huy vẽ tay, 2441 dòng) | `9bb3d61d…` |
| `08-class-diagram.drawio` | `32ae4349…` |
| `Sequence-Diagrams.drawio` (14 trang mermaid) | `680cab49…` |

Đây là rủi ro số 1 trong pre-mortem: `--force` sẽ ghi đè cả ba, và riêng
`05-use-case` là công vẽ tay của người khác.

---

## 5b. Sáu chỗ sơ đồ nói sai sự thật — chỉ thấy khi NHÌN ảnh

Render xong rồi mở ảnh ra xem (script tự ghi: *"rồi NHÌN, script này không tự
bắt lỗi"*). Sáu chỗ sai, mỗi chỗ đã đối chiếu với mã:

| Sơ đồ nói | Sự thật | Kiểm bằng |
|---|---|---|
| `Node.js 20` | Node 24 | `Dockerfile`, `ci.yml`, `deploy.yml` |
| `max_connections 200` | compose không đặt; app `connectionLimit 15` | `docker-compose.yml`, `app.module.ts:131` |
| `Admin workstation (planned)`, **tô đỏ** | đã live | `admin.zoldify.com` → HTTP 200 |
| `build image, push to GHCR` | không có registry nào | grep `ghcr\|docker push\|registry` trong `deploy.yml` → **0** |
| `SSH compose pull && up -d` | `git reset --hard` rồi `compose up -d --build` | `deploy.yml` |
| *"there is no .github/workflows anywhere"* | có cả `ci.yml` lẫn `deploy.yml` | thư mục `.github/workflows/` |

Ô **Roll back vẫn đỏ**, và lần này đỏ đúng: không có registry thì không có "ảnh
trước" để quay về. Đã ghi thẳng lý do vào ghi chú thay vì để người đọc tự đoán.

Hai hộp ghi chú vàng còn **đè chữ lên nhau** trong bản render — vì nội dung đã
dài ra mà chiều cao hộp giữ nguyên. Đã viết gọn lại.

### Sơ đồ container (`r2-container`) còn lỗi thời nặng hơn

Đây là sơ đồ kiến trúc trung tâm của báo cáo, và nó đang **kể thiếu ba việc
nhóm đã làm xong**:

| Sơ đồ nói | Sự thật | Kiểm bằng |
|---|---|---|
| `Worker x1 (planned)`, **đỏ** — *"today the cron runs inside the API"* | worker là dịch vụ riêng trong compose, cron đã ra khỏi API, lịch nằm trong Redis | task #14; `check:worker` dựng **hai** worker thật rồi đếm số lần chạy |
| `Admin web (planned)`, **đỏ** | `admin.zoldify.com` trả HTTP 200 | gọi thật |
| *"STILL IN-PROCESS: throttler counters và socket lists"* | cả hai đã qua Redis | `ThrottlerStorageRedisService` (`app.module.ts:101`), `src/common/redis-io.adapter.ts` |
| `Cloudflare R2 (planned)` | client R2 **có thật** ở `src/catalog/files/storage.service.ts`, chỉ tắt mặc định | đổi thành `(opt-in) — on when R2_* are filled` |
| *"compose is config-verified but NOT yet brought up — the author box has no Docker. Still no worker."* | đã dựng cả cụm thật từ volume rỗng | caddy + 3 api + 1 worker + mysql + redis, đo 28/09 |

Ghi chú của sơ đồ nay thay bằng **số đo thật**: 90 request qua caddy chia
**31 / 35 / 32**, và một client bị chặn ở đúng 10 request trong khi client thứ
hai vẫn được phục vụ — chỉ xảy ra được nếu bộ đếm dùng chung qua Redis và IP
thật của client sống sót qua proxy.

Cũng sửa một điểm tự mâu thuẫn: chú giải ghi *"Red = decided, not built"* trong
khi ô đỏ duy nhất còn lại (R2) là **đã dựng nhưng tắt mặc định**.

### Tiếng Việt trong sơ đồ

Thầy ghi rõ: *"không được nửa tiếng anh nửa tiếng việt"*. Quét bằng Node (không
dùng `grep` — nó so theo **byte** nên `«`, `»`, `—` khớp nhầm với dấu tiếng Việt
và thổi con số từ 4 file lên 12):

| Lúc đầu | Sau |
|---|---|
| 6 nhãn tiếng Việt trong 4 file | **3 nhãn, chỉ còn trong file gộp của Huy** |

Ba nhãn đã dịch: ghi chú fork/join của `06-activity-diagram`, ngưỡng số tiền nạp
ví (`10.000đ` → `10,000 VND`), và nhãn Redis của `r2-container`. Hai trong số
các nhãn tiếng Việt là **do chính tôi vừa thêm vào** lúc sửa — đã dọn.

---

## 6. Ảnh PNG đang cũ hơn nguồn

Phát hiện lúc nghiệm thu, và nó ảnh hưởng thẳng tới báo cáo:

| | Lần sửa cuối |
|---|---|
| `scripts/make-drawio.mjs` (bộ sinh) | **23/08** |
| `docs/system-design/drawio/renders/` (20 ảnh) | **14/08** |

Ảnh cũ hơn nguồn **9 ngày**. Nghĩa là 20 tấm PNG đang mô tả một hệ thống khác
với thứ bộ sinh mô tả. Đã render lại toàn bộ bằng `npm run drawio:shoot`.

### Sơ đồ triển khai nay mới đúng sự thật

`11-deployment-diagram.drawio` khai:

```
caddy:2 · zoldify-api x3 · mem_limit 512M · mem_limit 256M
```

`docs/bao-cao/task-24-25-backup-restore.md` từng ghi đây là *"sơ đồ đang mô tả
nhiều thứ chưa có thật"*. Sau task #6 (nhánh `feat/task-6-caddy-mem-limit`) thì
compose có đúng cả bốn thứ đó, nên **sơ đồ này thôi nói dối** — với điều kiện
nhánh task #6 được gộp.

---

## 7. Còn lại

0. **HAI NGUỒN SỰ THẬT — phải chọn một.** Sau việc hôm nay, mỗi sơ đồ tồn tại ở
   **hai chỗ**: một trang trong `05-use-case-diagram.drawio` (bản 24/08, đông
   cứng, đang sai 4 chỗ) và một file riêng do `make-drawio.mjs` sinh (bản hiện
   tại, đã sửa). Hai bản **sẽ lệch tiếp**.

   Đề nghị: lấy **bộ sinh** làm nguồn, vì nó regenerate được và `drawio:check`
   gác được. Rồi một trong hai cách với file gộp:
   - viết thêm bước ghép 20 trang từ bộ sinh ra một file, để vẫn mở một lần
     xem hết trong draw.io — cách này giữ được tiện lợi của Huy mà không lệch;
   - hoặc đổi tên nó thành `_snapshot-2026-08-24.drawio` để không ai tưởng nó
     là bản đang dùng.

   **Đây là việc của Huy** (`05-use-case-diagram.drawio` là công của bạn ấy),
   nên tôi không tự quyết.

1. **`push_tokens` không có trong ERD, cũng không có trong lược đồ `staging`** —
   nó chỉ tồn tại trên nhánh production. ERD `.puml` hiện có 25 entity và khớp
   đúng 25 bảng của staging; nhưng lúc gộp production ↔ staging sẽ lòi ra một
   bảng chưa ai vẽ. Việc này cần Đạt, đã ghi trong `docs/BAN-GIAO.md`.
2. ~~`drawio:check` có chạy trong CI không~~ — **đã kiểm: có** (`ci.yml:243`,
   kèm comment *"drawio:check thuần JS, không cần trình duyệt — chặn thật
   được"*). Nên mục đếm sơ đồ mới thêm sẽ chặn ngay từ PR kế tiếp: từ nay xoá
   một file `.drawio` là CI đỏ.
