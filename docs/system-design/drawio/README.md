# Sơ đồ draw.io: bảng tra

Bảy file: bốn file đúng bốn slide có sơ đồ trong `3. Project Templates/Project Presentation Template.pdf`,
ERD, và hai file chỉ để chiếu (bản rút gọn, trang Payment tách đôi). Mở bằng [app.diagrams.net](https://app.diagrams.net) hoặc draw.io desktop.

| Slide | File | Ghi chú |
|---|---|---|
| 5 Use Case | `05-use-case-diagram.drawio` | 7 trang: tổng quan + UC01 đến UC06 |
| 6 Activity Diagram | `activity_zoldify.drawio` | 15 trang, nhóm vẽ tay |
| 8 Class Diagram | `08-class-diagram.drawio` | 3 trang: Domain Model, Enumerations, Money Services |
| 9 Sequence Diagram | `Sequence-Diagrams.drawio` | 14 trang, slide 9 dùng trang Payment |
| ERD | `10-entity-relationship-diagram.drawio` | 4 trang theo vùng, 27 bảng, crow's foot |
| Slide chiếu | `12-slide-diagrams.drawio` | 13 trang rút gọn, chữ đủ lớn khi chiếu: deployment, UC02, UC04, activity, class, sequence, ERD tiền, dòng tiền, hai người mua, bút toán, vận hành |
| Slide dự phòng | `13-payment-parts.drawio` | trang Payment tách hai trang: webhook, ghi sổ |

Slide 11 (Deployment) nhóm đã bỏ (12/10), cùng 16 sơ đồ cũ khác (bảy `06*-activity`,
`09-sequence-diagram`, `r1` đến `r8`) và bộ sinh `make-drawio.mjs`. ERD bỏ cùng đợt nhưng
11/11 dựng lại cho slide bảo vệ và mục ERD của báo cáo, từ bộ sinh ở `b6d5773`, theo
schema hiện tại (thêm `user_sessions`, `admin_action_logs`; bỏ `payos_webhook_logs`).

Ảnh xem nhanh từng trang ở `renders/`, mở `renders/index.html` để xem tất cả.

Kiểm trước khi giao: `npm run drawio:check`. Bộ kiểm đòi đủ các file trên: bốn file đọc
tên từ bộ sinh, file activity ghi ở `VE_TAY` trong `scripts/check-drawio.mjs`.

## Use case chi tiết, Class, Sequence, ERD: sinh từ script

**Ngoại lệ:** ngày 12/10 nhóm sửa tay trong draw.io trên `05-use-case-diagram` (UC02 đến
UC06), `08-class-diagram` và `Sequence-Diagrams` (4da2d59). Ba file đó **đừng chạy lại bộ sinh
cho cả file**: nó đè mất chỉnh tay (đã xảy ra ở a1fb166, sửa lại ở dbda431). Spec use case đã bỏ
actor hệ thống cho khớp bản tay, nhưng vị trí kéo tay thì spec không biết.

Vẽ theo ký pháp UML 2.5 của uml-diagrams.org (đen trắng, nét thẳng, không đường nào cắt
nhau), đối chiếu từng luồng với code. Muốn sửa thì sửa nguồn rồi sinh lại, đừng kéo thả
trong draw.io vì lần sinh sau sẽ đè:

| File | Nguồn | Lệnh |
|---|---|---|
| `05-use-case-diagram.drawio` | Trang tổng quan: `buildOverview` trong script. Trang UC01 đến UC06: `scripts/drawio-specs/usecase/NN-*.json` | `node scripts/drawio-usecase.mjs` |
| `08-class-diagram.drawio` | `scripts/drawio-class.mjs` (toạ độ, thuộc tính, quan hệ) | `node scripts/drawio-class.mjs` |
| `Sequence-Diagrams.drawio` | `scripts/drawio-specs/sequence/NN-*.json`, mỗi file một trang | `node scripts/drawio-sequence.mjs` |
| `10-entity-relationship-diagram.drawio` | entity TypeORM qua `scripts/drawio-erd-model.mjs`, bố cục ở `scripts/drawio-erd.mjs` | `node scripts/drawio-erd.mjs` |
| `12-slide-diagrams.drawio` | `scripts/drawio-slides.mjs` | `node scripts/drawio-slides.mjs` |
| `13-payment-parts.drawio` | `scripts/drawio-specs/sequence/07-payment.json` | `node scripts/drawio-payment-parts.mjs` |

Riêng file use case: trang đầu (tổng quan) vẽ ngang 16:9 để chiếu được trên slide, có 5 actor:
Guest, User kế thừa Guest, Buyer và Seller kế thừa User, Administrator. Mỗi trang UC là một nhóm chức năng: actor bên trái, use case gốc ở
giữa, use case `«include»` / `«extend»` bên phải. Không vẽ actor hệ thống ngoài (GHN, PayOS,
FCM): nhóm bỏ ngày 12/10.

Class và ERD dùng `scripts/drawio-grid.mjs`: script tự từ chối ghi file nếu có đường nối xiên,
cắt nhau, hay đi xuyên qua hộp khác.

## Xuất ảnh cho slide và báo cáo

Trong draw.io: **File → Export as → PNG** (tắt *Transparent Background*, *Zoom* 200%)
cho PowerPoint, hoặc **SVG** cho Word. Đề bài **cấm chụp màn hình sơ đồ**: ảnh chụp màn
hình mờ và có viền cửa sổ, nhìn ra ngay.

Bản Mermaid trong `docs/system-design/*.md` chỉ để đọc nhanh trong PR, không phải bản nộp.
Chỗ nào lệch nhau thì `.drawio` là bản đúng.
