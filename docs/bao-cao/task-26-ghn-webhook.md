# Task #26 — Webhook GHN (AD-03 ô T3)

**Vai:** B — Platform · DevOps · Backend nghiệp vụ
**Hạn theo bảng phân công:** 28/08 → 30/08 · **Làm ngày:** 31/08 (trễ 1 ngày)
**Nhánh:** `feat/task-26-ghn-webhook` · **Bài kiểm:** `npm test` (11 ca mới)

---

## 1. Mục tiêu & bối cảnh

AD-03 vẽ ba đường kết thúc thời gian giữ tiền ký quỹ. Ô **T3** là *"GHN webhook,
status = delivered"* — đường duy nhất trong ba đường chưa có mã.

Trước task này, hệ thống chỉ biết hàng đã giao bằng cách **hỏi vòng mỗi giờ**
(`syncGhnShipmentStatuses`, chạy trong tiến trình worker từ task #14). Chậm nhất
một giờ mới biết, và mỗi lượt quét gọi GHN một lần cho mỗi lô đang chờ.

## 2. Vì sao đường này nguy hiểm hơn mọi endpoint khác

Webhook là endpoint **công khai, không JWT** — GHN gọi vào chứ không phải người
dùng. Và thứ nó làm là đánh dấu lô hàng "đã giao", mà `delivered_at` chính là mốc
để `autoConfirmDueShipments` đếm cửa sổ rồi **giải ngân escrow cho người bán**.

Nói thẳng: **ai giả được webhook này thì sau N ngày là rút được tiền người mua
đang ký quỹ, không cần đăng nhập.**

Nên toàn bộ thiết kế xoay quanh một câu hỏi: *làm sao để giả mạo cũng vô hại.*

## 3. Pre-mortem (TRƯỚC khi viết mã)

| # | Mức | Rủi ro | Cách chặn |
|---|-----|--------|-----------|
| **W1** | **RẤT CAO** | Endpoint công khai → ai cũng đánh dấu "đã giao" được → rút được tiền ký quỹ. | **Không tin thân request.** Webhook chỉ là tín hiệu; gọi ngược `getOrderStatus` hỏi lại GHN mới là nguồn sự thật. Cộng token bí mật, so bằng `timingSafeEqual`. |
| **W2** | **CAO** | GHN gửi lại (retry) → đánh dấu hai lần → cửa sổ tự-xác-nhận bị đẩy lùi mỗi lần. | Chỉ đi một chiều `CREATED → DELIVERED`; đã chuyển rồi thì no-op. |
| **W3** | **CAO** | Webhook tới sai thứ tự → kéo `RECEIVED` (đã giải ngân) ngược về `DELIVERED`. | Không bao giờ lùi trạng thái. |
| **W4** | TB | Chép lại logic chuyển trạng thái → hai bản sao lệch nhau. | Rút `danhDauDaGiao()` dùng chung cho **cả** webhook lẫn lượt quét định kỳ. |
| **W5** | TB | Mã vận đơn lạ → ném 500 → GHN retry mãi mãi. | Trả 200 + ghi log. |
| **W6** | TB | Coi webhook là bản thay thế cron poll → GHN không gọi được là mất hẳn sự kiện. | **Giữ nguyên** lượt quét mỗi giờ làm lưới an toàn. |

## 4. Test viết TRƯỚC (đỏ → xanh)

`src/ordering/orders/shipment-tracking.service.spec.ts` — 11 ca, commit `de36099`,
**trước khi có dòng mã sản phẩm nào**; chạy ngay thì đỏ vì service chưa tồn tại.

**Dùng jest spec chứ không thêm một `scripts/selfcheck-*.ts` nữa.** Lý do thực
dụng: thêm suite mới phải sửa `package.json` và `scripts/selfcheck-all.ts` — đúng
hai file mà cả bốn PR đang mở của tôi đều chạm. Cách này xung đột bằng không, mà
`npm test` vốn đã là cổng CI.

### Thử đột biến — chứng minh bài kiểm không rỗng

Cho service **tin** `body.Status` thay vì hỏi lại GHN:

```
● ShipmentTrackingService — webhook GHN › webhook NÓI đã giao mà GHN bảo chưa → không đổi gì
Tests: 1 failed, 10 passed, 11 total
```

Đúng một mục, đúng mục quan trọng nhất.

## 5. Ba quyết định thiết kế

**Không tin thân request.** GHN gửi kèm trạng thái, nhưng lấy thẳng nó mà ghi vào
database thì bí mật trong URL là thứ *duy nhất* chắn giữa kẻ lạ và tiền ký quỹ —
mà URL thì nằm trong log máy chủ, log proxy, lịch sử trình duyệt của người cấu
hình. Rò một lần là rò vĩnh viễn. Nên webhook chỉ là tín hiệu *"có gì đó đổi, đi
xem đi"*; trạng thái thật lấy bằng cách hỏi chính GHN. **Kẻ giả mạo biết cả URL
lẫn mã vận đơn thì cùng lắm làm hệ thống tốn một request sang GHN.**

**`timingSafeEqual` chứ không `===`.** So chuỗi thường thoát ra ngay ký tự đầu
khác nhau, nên thời gian trả lời rò rỉ token đúng được bao nhiêu ký tự. Dò từng
ký tự thì token 32 ký tự chỉ còn vài nghìn lần thử thay vì 62³². Đây là endpoint
dẫn tới tiền, không đáng tiết kiệm chỗ này.

**`GHN_WEBHOOK_TOKEN` trống = khoá hẳn, không phải "tắt kiểm tra".** Một webhook
tiền để trống biến môi trường là mở toang. Thà 401 hết và người deploy phải điền
— lượt quét mỗi giờ vẫn bắt được trạng thái, chỉ chậm hơn.

## 6. Nghiệm thu

### Cổng (chạy cục bộ)

| Cổng | Kết quả |
|---|---|
| `lint:check` | **980** / mốc 980 |
| `boundaries:check` | 28 / mốc 28 |
| `build` · `openapi:check` | OK |
| `npm test` | **63/63** — 9 suite (trước: 52) |

### Chạy thật qua HTTP

Dựng API rồi gọi bằng `curl`:

```
1) không token            → 401
2) token sai              → 401
3) token đúng, mã lạ      → 200 {"known":false,"updated":false}
4) nói dối "delivered"    → 200 {"known":false,"updated":false}
```

## 7. Một lỗi đã sửa ngay trong lúc làm

Bản đầu tôi viết lý giải bảo mật trong khối `/** */`. **Nest đọc JSDoc rồi đổ vào
`summary` của `openapi.json`, mà Swagger được phục vụ công khai ở `/api/docs`
(`main.ts`, không guard).** Kết quả: mô tả tường tận cách webhook tiền tự xác
thực và điểm yếu của nó nằm trong tài liệu ai cũng đọc được.

Chuyển hết sang comment `//` — Nest không đọc kiểu đó. Mô tả trong openapi từ
~1.500 ký tự còn **395**, không còn chữ nào về `timingSafeEqual` hay ký quỹ.

> **Ghi cho task #34 (rà bảo mật):** Swagger đang mở công khai ở `/api/docs`
> không guard. Webhook PayOS cũng có `summary` mô tả cơ chế trong đó. Đáng rà lại
> toàn bộ khi làm #34.

## 8. Giới hạn & phát hiện ngoài phạm vi

**Chưa nghiệm thu với GHN thật.** Cần URL công khai để khai trong bảng điều khiển
GHN — làm được sau khi PR merge và deploy. Đã kiểm bằng `curl` trên máy và bằng
11 ca test với DB thật.

**Chưa làm phần "tồn kho real-time".** Bảng phân công gộp nó vào cùng dòng #26 và
nó mới là phần tính **điểm Level 3** (mục 74: *"gợi ý sản phẩm, tồn kho real-time
— hai cái sau là điểm Level 3"*). PR này chỉ làm webhook GHN. Tách ra vì webhook
là đường tiền, đáng review riêng.

**Gốc "hoàn tiền hai lần" vẫn chưa sửa** (đã nêu ở task #14):
`OrdersService.cancelExpired` đọc đơn ngoài transaction, không khoá dòng. Không
đụng vì đó là mã tiền của vai A và task #21 đang sửa đúng những dòng đó.

### Đính chính báo cáo tiến độ trước: **task #13 gần như đã xong**

Tôi từng báo *"#13 upload R2 — chưa làm, `CDN_BASE_URL` không tồn tại trong
`src/`"*. **Sai.** Tôi tìm theo tên biến trong bảng phân công, còn mã dùng
`R2_PUBLIC_URL`. Thực tế đã có `src/catalog/files/storage.service.ts` với
`S3Client` + `PutObjectCommand`, `FilesController` gọi nó, `.env.sample` khai đủ
6 biến R2.

Còn đúng **một** chỗ chưa đạt yêu cầu: `files.controller.ts:78` vẫn ghép URL từ
`req.get('host')` ở nhánh dự phòng khi R2 chưa cấu hình — mà bảng phân công ghi
rõ *"bỏ ghép từ `req.get('host')`"*. Đề xuất: thay bằng `API_PUBLIC_URL` (biến đã
có sẵn), giữ được nhánh dự phòng cho máy dev mà bỏ được phụ thuộc vào header
`Host` do client gửi. Việc nhỏ, nên làm riêng một PR của #13.
