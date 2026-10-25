# Giả lập GHN (PATCH /orders/:id/sim-ghn)

*Ghi 25/10/2026, cùng bản vá quyền của trình giả lập.*

GHN sandbox không có shipper thật, nên nhóm dùng nút giả lập để demo luồng
"đang giao" và "đã giao". Mã ở `OrdersService.simulateGhnStatus`.

## Bật, tắt

Biến môi trường `GHN_SIMULATOR` (không thêm được vào file mẫu biến môi trường
vì hook của máy dev chặn mọi đường dẫn tên `.env*`, nên ghi ở đây):

| Giá trị | Hành vi |
|---|---|
| `on` | Bật, bất kể `GHN_HOST` trỏ đâu. Dùng cho máy demo. |
| `off` | Tắt hẳn, kể cả khi `GHN_HOST` là sandbox. |
| không đặt (hoặc giá trị khác) | Như trước 25/10: chỉ bật khi `GHN_HOST` chứa `dev-online-gateway`. Không đặt `GHN_HOST` thì tắt. |

Production nên để `GHN_SIMULATOR=off` cho chắc, dù không đặt thì GHN thật đã tắt.

## Ai được gọi phase nào

| phase | Ai | Điều kiện đơn |
|---|---|---|
| `shipping` | người bán của đơn, hoặc admin | đơn `confirmed` hoặc `processing`, mọi người bán đã có vận đơn hợp lệ |
| `delivered` | **chỉ admin** | đơn đang `shipping` |

Vì sao `delivered` chỉ admin: vận đơn DELIVERED là thứ cron chốt vận đơn dựa
vào để giải ngân ký quỹ cho người bán. Trước bản vá, người bán tự bấm được
"đã giao" trên sandbox và nhận tiền dù chưa gửi hàng; đơn đã huỷ hay đã hoàn
tiền cũng giả lập "đã giao" được.

Client đang dùng (kiểm 25/10): admin web trang Đơn hàng gọi cả hai phase; app
người bán chỉ gọi `shipping`. Hai luồng đó giữ nguyên.

Body kiểm bằng `SimGhnDto`: `phase` ngoài `shipping`/`delivered` trả 400.
Bài kiểm: `src/ordering/orders/gia-lap-ghn-quyen.spec.ts`.
