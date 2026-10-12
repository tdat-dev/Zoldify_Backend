# Sơ đồ draw.io: bảng tra

Bốn file, đúng bốn slide có sơ đồ trong `3. Project Templates/Project Presentation Template.pdf`.
Mở bằng [app.diagrams.net](https://app.diagrams.net) hoặc draw.io desktop.

| Slide | File | Ghi chú |
|---|---|---|
| 5 Use Case | `05-use-case-diagram.drawio` | 7 trang: tổng quan (vẽ tay) + UC01 đến UC06 |
| 6 Activity Diagram | `activity_zoldify.drawio` | 15 trang, nhóm vẽ tay |
| 8 Class Diagram | `08-class-diagram.drawio` | 3 trang: Domain Model, Enumerations, Money Services |
| 9 Sequence Diagram | `Sequence-Diagrams.drawio` | 14 trang, slide 9 dùng trang Payment |

Slide 10 (ERD) và 11 (Deployment) nhóm đã bỏ (12/10), cùng 16 sơ đồ cũ khác
(bảy `06*-activity`, `09-sequence-diagram`, `r1` đến `r8`) và bộ sinh `make-drawio.mjs`.
Cần lại thì lấy trong lịch sử git; bản ERD crow's foot và deployment vẽ lại nằm ở
`b6d5773` và `f648b68`. Mẫu báo cáo Word vẫn có mục ERD và Deployment Diagram.

Ảnh xem nhanh từng trang ở `renders/`, mở `renders/index.html` để xem tất cả.

Kiểm trước khi giao: `npm run drawio:check`. Bộ kiểm đòi đủ bốn file trên: ba file đọc
tên từ bộ sinh, file activity ghi ở `VE_TAY` trong `scripts/check-drawio.mjs`.

## Use case chi tiết, Class và Sequence: sinh từ script, không sửa tay

Vẽ theo ký pháp UML 2.5 của uml-diagrams.org (đen trắng, nét thẳng, không đường nào cắt
nhau), đối chiếu từng luồng với code. Muốn sửa thì sửa nguồn rồi sinh lại, đừng kéo thả
trong draw.io vì lần sinh sau sẽ đè:

| File | Nguồn | Lệnh |
|---|---|---|
| `05-use-case-diagram.drawio`, các trang UC01 đến UC06 | `scripts/drawio-specs/usecase/NN-*.json`, mỗi file một trang | `node scripts/drawio-usecase.mjs` |
| `08-class-diagram.drawio` | `scripts/drawio-class.mjs` (toạ độ, thuộc tính, quan hệ) | `node scripts/drawio-class.mjs` |
| `Sequence-Diagrams.drawio` | `scripts/drawio-specs/sequence/NN-*.json`, mỗi file một trang | `node scripts/drawio-sequence.mjs` |

Riêng file use case: trang đầu (tổng quan) là bản vẽ tay, script giữ nguyên nó và chỉ thay
các trang UC phía sau. Mỗi trang UC là một nhóm chức năng: actor bên trái, use case gốc ở
giữa, use case `«include»` / `«extend»` bên phải, actor hệ thống ngoài (GHN, PayOS, FCM)
ngoài cùng.

Class dùng `scripts/drawio-grid.mjs`: script tự từ chối ghi file nếu có đường nối xiên,
cắt nhau, hay đi xuyên qua hộp khác.

## Xuất ảnh cho slide và báo cáo

Trong draw.io: **File → Export as → PNG** (tắt *Transparent Background*, *Zoom* 200%)
cho PowerPoint, hoặc **SVG** cho Word. Đề bài **cấm chụp màn hình sơ đồ**: ảnh chụp màn
hình mờ và có viền cửa sổ, nhìn ra ngay.

Bản Mermaid trong `docs/system-design/*.md` chỉ để đọc nhanh trong PR, không phải bản nộp.
Chỗ nào lệch nhau thì `.drawio` là bản đúng.
