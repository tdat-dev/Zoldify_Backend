# Dàn ý báo cáo 50 trang — bám đúng `Project Report_en-Template.docx`

**Ngày:** 2026-09-24 · Nguồn: `3. Project Templates/` (đã giải nén và đọc hết)

> Thầy nói 5 lần: *"không được tự ý nghĩ ra mẫu khác"*. Dàn ý này giữ **nguyên
> tiêu đề tiếng Anh của mẫu**, không thêm bớt chương nào. Phần ghi chú tiếng
> Việt là để nhóm biết lấy nguyên liệu ở đâu — **không đưa vào bản nộp**.

---

## 0. Luật trình bày, chép nguyên từ mẫu

| | |
|---|---|
| Bìa | **in màu xanh**, đúng khuôn trang 1 của file mẫu |
| Khổ giấy | A4 (210 × 297 mm), **in một mặt** |
| Lề | Trên 20-25 · Dưới 20-25 · **Trái 30-35** · Phải 15-20 (mm) |
| Header | Trái: **logo VTC Academy** · Phải: Project Name · Arial/Helvetica Neue 12pt |
| Footer | Trái: `Class_Name–Project_Name` · Phải: số trang · 12pt |
| Nội dung | Arial hoặc Helvetica Neue Light, **12pt** |
| Độ dài | **tối thiểu 50 trang** |

Logo đã có sẵn: `3. Project Templates/logo-vtc-academy-plus-color.png`.

**Toàn bộ nội dung tiếng Anh.** Thầy nhắc ba lần, có câu *"không được nửa tiếng
anh nửa tiếng việt"*. Nghĩa là cả chú thích trong ảnh sơ đồ, cả tên cột trong
bảng CSDL, cả chữ trong ảnh chụp màn hình giao diện — nếu web đang để tiếng Việt
thì **chụp màn hình ở bản `en`** (may là đã có `next-intl` với `en.json` đủ 33
namespace).

---

## 1. Phân bổ trang để chạm 50

| Chương | Trang | Vì sao đủ dày |
|---|---|---|
| I. Project Introduction | 5 | 7 mục con bắt buộc của mẫu |
| **II. Analyze System Requirements** | **20** | **18 use case × ~1 trang** + 7 activity diagram |
| III. Design Details | 16 | UI + class + 14 sequence + ERD 24 bảng |
| IV. Test | 6 | 23 test case đã có số đo thật |
| V. Task Assignment | 3 | bảng theo tuần, 5 thành viên |
| VI. Installation Instructions | 5 | deployment diagram + 3 bước cài |
| Appendix | 3 | thuật ngữ, tham chiếu, bài học |
| **Tổng** | **58** | dư 8 trang để co giãn |

Chương II là chỗ gánh trang. **Đừng viết use case sơ sài rồi phải độn chỗ khác.**

---

## 2. I. Project Introduction — 5 trang

Mẫu yêu cầu đúng 7 mục con, không được bỏ mục nào:

| Mục của mẫu | Viết gì | Lấy ở đâu |
|---|---|---|
| *(mở đầu)* Describe the operation of the system | Sàn C2C đồ cũ: người dùng vừa mua vừa bán, tiền giữ hộ (escrow) tới khi người mua xác nhận nhận hàng | `docs/system-design/` |
| **Proposed System** | Nêu vấn đề của chợ đồ cũ hiện tại (không ai giữ tiền hộ → lừa đảo) → Zoldify giải bằng escrow + sổ cái kép | viết mới |
| **The Scope of the Project** | Trong phạm vi: mua–bán–thanh toán–vận chuyển–chat. Ngoài phạm vi: đấu giá, trả góp, đa tiền tệ (nêu rõ lý do — xem comment `product.entity.ts` về `currency`) | `product.entity.ts:50-70` |
| **System Name** | Zoldify — C2C Second-hand Marketplace | |
| **Deployment Environment** | **Bảng 6 domain, 3 tầng × 2 môi trường** — xem mục 6 của dàn ý này | đã kiểm live 24/09 |
| **Development Tools** | VS Code, Docker Desktop, MySQL Workbench, Postman, draw.io, Git/GitHub, Trello, EAS | |
| **Customer Requirements (System Features)** | Liệt kê theo 4 actor, khớp với 18 use case ở chương II | `05-use-case-diagram.drawio` |

> Chỗ ăn điểm: phần **Deployment Environment** của các nhóm khác thường là một
> dòng "deploy lên hosting". Các bạn có 6 tên miền thật, tách production/staging,
> CI/CD tự động. Viết thành bảng + sơ đồ.

---

## 3. II. Analyze System Requirements — 20 trang

### 3.1 Use Case — phần nặng nhất

`05-use-case-diagram.drawio` trang 1 đã có sẵn **4 actor** và **18 use case**:

| Actor | Use case |
|---|---|
| **User** | Register an account · Sign in · Browse and search items · Exchange messages |
| **Buyer** | Manage cart · Place an order · Track an order · Confirm delivery · Top up wallet |
| **Seller** | List an item for sale · Manage sales orders · View wallet and transactions · Request a withdrawal |
| **Administrator** | Review withdrawal requests · Manage users · Moderate listings · Reconcile the ledger · Release payment to seller |

Mỗi use case **một bảng đầy đủ 11 dòng** đúng mẫu:

```
Use Case Name · Use Case ID · Description · Actor · Organizational Benefits
Triggers · Preconditions · Postconditions
Main Course (đánh số bước) · Alternate Courses (AC1, AC2…) · Exceptions (EX1, EX2…)
```

**Đừng bịa phần Exceptions.** Mã nguồn đã có sẵn ngoại lệ thật, lấy thẳng ra:

| Use case | Exception có thật | Nguồn |
|---|---|---|
| Place an order | EX1: hết hàng giữa chừng → `"Sản phẩm X chỉ còn N trong kho"` | `orders.service.ts:288-292` |
| Place an order | EX2: giỏ lẫn hai loại tiền tệ → từ chối, không quy đổi | `orders.service.ts:165-172` |
| Place an order | EX3: tự mua hàng của chính mình → chặn | `orders.service.ts:145-149` |
| Place an order | EX4: người bán chưa khai địa chỉ lấy hàng → chặn đăng bán | `products.service.ts:70-88` |
| Confirm delivery | EX1: lô hàng GHN gửi thất bại → chưa thể xác nhận | `orders.service.ts:658-662` |
| Request a withdrawal | EX1: số dư không đủ → sổ cái từ chối **sau khi đã khoá dòng** | `ledger.service.ts:186-192` |
| Top up wallet | EX1: webhook PayOS sai chữ ký → từ chối | `payos.service.ts:428-434` |

> Đây là chỗ hội đồng hỏi sâu nhất, và là chỗ nhóm khác đuối nhất. Ngoại lệ dẫn
> được về `file:dòng` thì không ai cãi.

### 3.2 Activity Diagram

Mẫu yêu cầu, và **đã có sẵn 7 cái** trong `05-use-case-diagram.drawio`:

Place Order and Pay · Cancel an Order and Refund · List an Item for Sale ·
GHN Shipment · Top Up the Wallet · Login and Token Lifetime ·
Ledger Reconciliation (TO BE)

Ảnh đã render sẵn: `docs/system-design/drawio/renders/06*.png`.

---

## 4. III. Design Details — 16 trang

### 4.1 UI Design (~6 trang)

Mẫu ghi *"Design the main user interface and for each features"*. Chụp từ
**bản chạy thật, giao diện tiếng Anh**:

| Nguồn | Màn hình nên đưa vào |
|---|---|
| `zoldify.com` (30 trang) | Home · Search · Product detail · Cart · Checkout · Order tracking · Wallet · Shop settings · Chat |
| App mobile (16 feature) | Onboarding · Home · Product · Cart · Checkout · Orders · Chat · Notifications |
| `admin.zoldify.com` (7 trang) | Dashboard · Orders · Products · Categories · Users · **Withdrawals** · Settings |

⚠️ **Trang admin hiện đang ở nhánh `staging` của `Zoldify_Admin`, chưa lên
production.** Phải merge trước khi chụp — xem `ra-soat-web-admin.md`.

Có sẵn `07-screen-navigation` (`renders/r7-screen-navigation.png`) để mở đầu mục
này bằng sơ đồ luồng màn hình.

### 4.2 Code Design (Class Diagram) (~2 trang)

`08-class-diagram.drawio` · ảnh `renders/08-class-diagram.png`.

Bổ sung một đoạn giải thích kiến trúc **8 bounded context** và luật ranh giới
được ép bằng ESLint (`npm run boundaries:check`, mốc 28). Hội đồng hỏi "sao chia
module thế này" thì đây là câu trả lời có công cụ kiểm chứng.

### 4.3 Sequence Diagram (~4 trang)

`Sequence-Diagrams.drawio` có **14 sequence**: Login · Registration · Email
Verification · Password Reset · **Google OAuth** · Cart · Checkout · **Payment** ·
Product Create · Product Search · **Product Search (with Redis)** · Profile
Update · Shop · Chat.

Chọn 4-5 cái đưa vào báo cáo, ưu tiên: **Payment (PayOS webhook)**, Checkout,
Google OAuth, và **cặp Product Search / Product Search with Redis** — cặp này
kể được câu chuyện tối ưu bằng hai hình cạnh nhau.

Ngoài ra `09-sequence-diagram.png` (PayOS webhook) đã render sẵn.

### 4.4 Database Design (~4 trang)

Mẫu cho hai lựa chọn — **làm cả hai**, vì đây là chỗ dễ lấy trang và là chỗ thầy
hỏi kỹ:

1. **Entity Relationship Diagram** — `renders/10-entity-relationship-diagram.png`.
   **24 bảng · 34 khoá ngoại**.
2. **Database Design Details** — bảng cột cho **8-10 bảng lõi**: `users`,
   `products`, `orders`, `order_items`, `escrows`, `ledger_accounts`,
   `ledger_entries`, `ledger_transactions`, `payments`, `withdrawals`.
   Cột đúng mẫu: Column Name · Data Type · Constraints · Description.

> Lấy số thật từ DB `zoldify_staging` đã dựng sẵn ở `127.0.0.1:3307` (16
> migration, 26 bảng, 34 FK). Đừng chép tay từ entity — `information_schema` cho
> ra đúng kiểu dữ liệu và ràng buộc thật.

Nên có một đoạn riêng giải thích **sổ cái kép** (`ledger_entries` tổng luôn = 0,
`idempotency_key` UNIQUE). Đây là thứ khác biệt nhất của dự án so với các nhóm
khác — họ thường cộng thẳng `users.balance`.

---

## 5. IV. Test — 6 trang

Mẫu đòi 8 cột: Test Case Number · Name · Description · Preconditions · Input ·
Expected Output · Steps · Default Value Preserving.
**Có sẵn `TestCaseTemplate.xlsx`** — dùng đúng file đó.

Nguyên liệu đã có:

| Nguồn | Nội dung |
|---|---|
| `docs/bao-cao/kiem-thu-luong-mua-ban.md` | **23 test case** có kỳ vọng, kết quả đo thật, mã lỗi |
| 20 file `*.spec.ts` | Chạy trên **MySQL thật**, không mock |
| `npm run check:race` | 20 người bấm cùng lúc, kho không về âm |
| `docs/system-design/load-test.md` | RPS · p95 · event loop lag |

**Cách kể có lợi nhất:** viết mục này theo trình tự *viết test đỏ → sửa → test
xanh*, đúng quy trình 6 bước của nhóm. Hiện 23 test đang **đỏ** vì 5 lỗi P0 chưa
vá — **vá xong rồi mới chụp kết quả**, để bảng kết quả là 23/23 xanh.

> Thầy nói mục 18: *"Về phần unit test nên có vì các thầy cô cũng sẽ hỏi"*. Nhóm
> này không chỉ "có" — có test chạy trên database thật và test đua tranh. Nên
> dành hẳn một trang kể vì sao không mock repository.

---

## 6. V. Task Assignment — 3 trang

Bảng đúng mẫu: No · Task name · Description · Start Date · End Date · Member ·
Self-Assessment.

Dữ liệu rút từ **git thật** (đã đếm 24/09):

| Member | Backend | Frontend | Mobile | Admin | Tổng |
|---|---|---|---|---|---|
| Đặng Tiến Đạt | 108 | 380 | 83 | 7 | **578** |
| Nguyễn Huy | 25 | 131 | 4 | 11 | **171** |
| Lưu Mạnh Cường | 134 | — | — | — | **134** |
| `linkk` | — | 15 | — | — | 15 |
| `anday06` | 1 | 3 | — | — | **4** |

⚠️ Thầy chấm điểm tham gia theo git + Trello (mục 9.2, 9.3). **Hai thành viên
cuối cần có đóng góp thật trước khi nộp**, nếu không phần này tự tố cáo.

Slide mẫu số 11 đòi chia **theo tuần** (`Week 1 (x - y): Doing something`) — lấy
từ `git log --since --until` theo tuần là ra.

---

## 7. VI. Installation Instructions — 5 trang

Mẫu đòi: Deployment Diagram → Install Database → Install Server →
Install Application.

| Mục | Nguyên liệu |
|---|---|
| Deployment Diagram | `renders/11-deployment-diagram.png` + `r2-container.png` |
| Install Database | `DEPLOY.md` — Docker compose, MySQL 8, `npm run migration:run` |
| Install Server | `DEPLOY.md` — `.env` ba biến bắt buộc, `npm run docker:up` |
| Install Application | Frontend `npm run build`, Admin, Mobile qua **EAS build** |

`DEPLOY.md` mở đầu bằng đúng câu *"Tài liệu cho chương VI của báo cáo
(Installation Instructions)"* — viết sẵn cho mục này rồi, chỉ cần **dịch sang
tiếng Anh** và thêm ảnh chụp từng bước (mẫu ghi *"Detailed instructions with
pictures and notes"*).

Nên thêm một mục nhỏ về **CI/CD** — push lên `staging` là tự deploy qua SSH. Cái
này vượt yêu cầu và dễ gây ấn tượng.

### Bảng môi trường triển khai (đã kiểm live 24/09)

| Tầng | Production | Staging |
|---|---|---|
| Web | `zoldify.com` | `staging.zoldify.com` |
| Admin | `admin.zoldify.com` | `admin-staging.zoldify.com` |
| API | `api.zoldify.com` | `api-staging.zoldify.com` |

Cả 6 đều HTTP 200, TLS hợp lệ.

---

## 8. Appendix — 3 trang

| Mục của mẫu | Viết gì |
|---|---|
| Terms and abbreviations | C2C, Escrow, Double-entry ledger, Idempotency key, JWT, COD, GHN, PayOS, ERD, CI/CD, VPS |
| References | NestJS docs, Next.js docs, Expo docs, TypeORM docs, PayOS API, GHN API, Martin Fowler *Bounded Context* |
| **Some other issues** *(Results, limitations, experiences)* | Chỗ xịn nhất — xem dưới |

Mục cuối nên kể thật, vì nhóm có nguyên liệu mà nhóm khác không có:

- **Kết quả đo được**: baseline 1000 VU hỏng 99,55% → sau tối ưu; chat N+1 từ
  201 truy vấn xuống 3; trang sâu OFFSET 2,8s → keyset vài chục ms
- **Hạn chế thành thật**: chưa có recommendation, chưa có AI chat, chưa có
  offline mode, real-time mới ở chat chứ chưa ở tồn kho, một tiến trình API
- **Bài học**: ba lần đoán sai phải đo mới biết (ghi trong
  `request-id.middleware.ts`); bài kiểm đua R1/R4 lúc đầu chép SQL nên sửa xong
  vẫn đỏ; "đừng có bản sao thứ hai" của đường huỷ đơn

---

## 9. Slide — 14 trang, đúng mẫu `.pptx`

| # | Tiêu đề mẫu | Lấy từ |
|---|---|---|
| 1 | *(bìa)* Project Name · Class · Group · Members | |
| 2 | **OBJECTIVES** | giữ nguyên 10 gạch đầu dòng của mẫu |
| 3 | **INTRODUCTION TO PROJECT** | chương I |
| 4 | **CUSTOMER REQUIREMENTS** | chương I mục cuối |
| 5 | **USE CASE** — use case list + diagram | `renders/05-use-case-diagram.png` |
| 6 | **ACTIVITY DIAGRAM** — 2 cái | chọn Place Order + Cancel/Refund |
| 7 | **UI DESIGN** — 2 màn | Checkout + Admin Withdrawals |
| 8 | **CLASS DIAGRAM** | `renders/08-class-diagram.png` |
| 9 | **SEQUENCE DIAGRAM** | PayOS webhook |
| 10 | **ENTITY RELATIONSHIP DIAGRAM** | `renders/10-*.png` |
| 11 | **TASK ASSIGNMENT** — theo tuần | git log theo tuần |
| 12 | **EXPERIENCE LEARNED** — Good / Bad | mục Appendix |
| 13 | *(trống trong mẫu)* | để dành cho demo hoặc kết quả đo |
| 14 | **Q & A** | thêm câu cảm ơn (thầy dặn mục 17) |

**Sơ đồ phải export ảnh, cấm chụp màn hình** (thầy nói mục 19). Đã có sẵn 20 PNG
trong `renders/` — dùng đúng chúng, đừng mở draw.io ra chụp.

Thầy cũng cằn nhằn riêng về **header/footer slide làm lôm côm** (mục 7) — sửa
`Class Name` và `Group XX` ngay trong tên file mẫu, đừng để nguyên.

---

## 10. Việc phải làm TRƯỚC khi viết

Ba thứ này ảnh hưởng trực tiếp tới nội dung báo cáo, không phải làm sau:

| # | Việc | Vì sao chặn |
|---|---|---|
| 1 | **Hợp nhất production ↔ staging** (backend 142 commit, admin 7 trang) | Chụp màn hình và mô tả tính năng phải khớp bản live. Thầy mục 10: *"phải mở sản phẩm trên live"* |
| 2 | **Vá 5 lỗi P0 luồng tiền** | Để bảng test ở chương IV là 23/23 xanh thay vì 23 đỏ |
| 3 | **Bật lại Redis trên production** | `api.zoldify.com` đang trả `"redis":"off"`; báo cáo mà khoe caching thì hội đồng gọi `/health` là lộ |

Bốn tính năng còn thiếu (recommendation, AI chat, offline, real-time tồn kho)
thì **không chặn** — cứ ghi thật vào mục *Limitations* của Appendix. Thầy đánh
giá cao sự trung thực hơn là phát hiện ra chỗ nói quá.
