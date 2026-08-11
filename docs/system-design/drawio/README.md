# Sơ đồ draw.io — bảng tra

14 file, mở bằng [app.diagrams.net](https://app.diagrams.net) hoặc draw.io desktop.

Sinh lần đầu bằng `npm run drawio:make`. **Sau đó file `.drawio` là bản gốc** — sửa
thẳng trong draw.io, kéo thả thoải mái. Script mặc định **không ghi đè** file đã có;
chỉ `--force` mới đè, và nó sẽ xoá mọi chỉnh tay.

Kiểm trước khi giao: `npm run drawio:check`.

---

## Sáu sơ đồ có slide riêng trong mẫu

Thứ tự lấy đúng theo `3. Project Templates/Project Presentation Template.pdf` (15 slide).

| File | Slide | Chương báo cáo |
|---|---|---|
| `05-use-case-diagram.drawio` | 5 | II — Analyze System Requirements |
| `06-activity-diagram.drawio` | 6 | II |
| `08-class-diagram.drawio` | 8 | III — Design Details |
| `09-sequence-diagram.drawio` | 9 | III |
| `10-entity-relationship-diagram.drawio` | 10 | III |
| `11-deployment-diagram.drawio` | 11 | VI — Installation Instructions |

## Tám sơ đồ bổ sung

Không có slide riêng, nhưng cần cho báo cáo hoặc để hiểu hệ thống.

| File | Loại | Dùng ở đâu |
|---|---|---|
| `r1-system-context.drawio` | C4 mức 1 | Chương I |
| `r2-container.drawio` | C4 mức 2 | Chương I và VI |
| `r3-component-bounded-contexts.drawio` | Component Diagram (UML) | Chương III |
| `r4-fund-flow.drawio` | Sơ đồ dòng tiền | **Slide 14 đang trống** · chương III |
| `r5-state-order-lifecycle.drawio` | State Machine (UML) | Chương III |
| `r6-state-escrow-lifecycle.drawio` | State Machine (UML) | Chương III |
| `r7-screen-navigation.drawio` | Sơ đồ điều hướng | Chương III, mục UI Design |
| `r8-cicd-pipeline.drawio` | Quy trình triển khai | Phụ lục |

---

## Ba chỗ dễ mất điểm nếu vẽ sai ký pháp

Đây là lý do sáu sơ đồ bắt buộc phải dựng bằng draw.io chứ không dùng Mermaid: Mermaid
vẽ mọi thứ bằng hộp chữ nhật, mà thầy chấm ký pháp UML.

| Sơ đồ | Ký pháp bắt buộc |
|---|---|
| Use Case | Actor là **hình người que**, use case là **hình bầu dục**, có khung hệ thống |
| Deployment | Node là **hộp 3D**, artifact nằm bên trong |
| Activity | Fork/join là **thanh ngang đậm**, không phải hình tròn |

---

## Xuất ảnh cho báo cáo

Trong draw.io: **File → Export as → PNG** (bật *Transparent Background* tắt,
*Zoom* 200%) cho PowerPoint, hoặc **SVG** cho Word.

Đề bài **cấm chụp màn hình sơ đồ**. Ảnh chụp màn hình nhìn ra ngay vì mờ và có viền
cửa sổ. Riêng **ảnh chụp giao diện** ở mục UI Design thì được, đó là yêu cầu khác.

---

## Còn bản Mermaid song song

`docs/system-design/*.md` vẫn giữ 25 sơ đồ Mermaid, dùng để đọc nhanh trong PR và
để diff được bằng text. Chúng **không phải** bản nộp.

Chỗ nào hai bên lệch nhau thì **`.drawio` là bản đúng** — nó là thứ đi vào báo cáo.
Sửa `.drawio` xong nhớ sửa cả Mermaid, hoặc ghi rõ chỗ lệch.
