# Sơ đồ draw.io — bảng tra

15 file, mở bằng [app.diagrams.net](https://app.diagrams.net) hoặc draw.io desktop.

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
| `06b-activity-cancel-refund.drawio` | 6 *(cùng slide)* | II |
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

## Activity diagram: vẽ cái nào, bỏ cái nào

Mục II của báo cáo cần **nhiều** activity diagram, không phải một. Luật chọn:

> **Vẽ use case nào có rẽ nhánh, có lặp, hoặc có từ hai tác nhân trở lên.**
> Use case chỉ đọc và hiển thị thì không vẽ.

Luật này bảo vệ được trước người chấm: *"em vẽ chỗ có quyết định"* khác hẳn
*"em vẽ thiếu"*. Nó cũng đúng với thực tế ngành — không ai vẽ activity diagram
cho `xem danh sách sản phẩm`.

| Activity diagram | Trạng thái |
|---|---|
| Đăng ký + OTP email | AD-01 *(bản Mermaid)* |
| Đặt hàng và thanh toán | `06-activity-diagram.drawio` = AD-02 |
| Giải ngân ký quỹ | AD-03 *(bản Mermaid)* |
| Rút tiền ba chặng | AD-04 *(bản Mermaid)* |
| **Huỷ đơn và hoàn tiền** | `06b-activity-cancel-refund.drawio` |
| Đăng bán một món | chưa vẽ |
| Tạo vận đơn GHN + đồng bộ trạng thái | chưa vẽ |
| Nạp ví | chưa vẽ |
| Đăng nhập + làm mới token | chưa vẽ |
| Đối soát sổ cái | chưa vẽ |

**Cố ý không vẽ**, mỗi cái một lý do sẵn để trả lời: tìm kiếm · giỏ hàng ·
theo dõi đơn · xem ví · quản lý người dùng · quản lý đơn bán · duyệt tin ·
nhắn tin. Tất cả đều là đọc-hiển-thị, hoặc đã được `r5` state machine phủ.

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
