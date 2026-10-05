# Báo cáo kiểm thử — luồng mua bán, thanh toán và tồn kho

**Ngày:** 2026-09-21 · **Nhánh soát:** `staging` @ `5630253` · **Phạm vi:** `ordering`, `money`, `catalog/products`

---

## 1. Vì sao có tài liệu này

Đây là bước 3 của quy trình 6 bước trong `docs/BAN-GIAO.md`:

> **Viết bài kiểm TRƯỚC**, chạy nó, **xác nhận nó ĐỎ**. Bài kiểm không thể đỏ thì
> không dùng để nghiệm thu được.

22 lỗi dưới đây tìm ra bằng cách **đọc mã** nhánh `staging`. Đọc mã thì có thể đọc
nhầm — nên mỗi lỗi đi kèm một test case, và test case đó phải **đỏ trên `staging`
hôm nay**. Cái nào không đỏ được thì lỗi đó coi như chưa chứng minh, gạch khỏi
danh sách chứ không "sửa cho chắc".

Thứ tự làm: danh sách này → viết spec → chạy → **ghi số thật vào mục 6** → mới vá.

---

## 2. Cách đọc bảng

| Cột | Nghĩa |
|---|---|
| **Mức** | P0 tiền tự sinh hoặc tiền mất · P1 tồn kho sai · P2 luồng mua hỏng · P3 rò rỉ / phụ |
| **Kỳ vọng ĐÚNG** | Điều test khẳng định. Đây là hợp đồng, không phải mô tả mã hiện tại. |
| **Thực tế `staging`** | Điều mã hiện tại làm — chính là lý do test đỏ. |

Ký hiệu tài khoản sổ cái: `HOLD` = `platform/escrow_hold`, `AVL(x)` = `user/available`
của x, `GW` = `external/gateway_clearing`.

---

## 3. Bảng tổng hợp 22 lỗi

### P0 — tiền tự sinh / tiền mất

| # | Lỗi | Vị trí |
|---|---|---|
| BUG-01 | Người mua tự đánh dấu payment `success` → `orders.is_paid = 1`, không trả đồng nào | `money/payments/payments.service.ts:201-224` |
| BUG-02 | Escrow tạo lúc **tạo link**, chưa có tiền → `release()` rút từ `HOLD` rỗng, `HOLD` âm | `money/payos/payos.controller.ts:55` |
| BUG-03 | Trả bằng ví: trừ ví vào `HOLD` nhưng **không tạo escrow**, **không đổi trạng thái đơn** | `money/payments/payments.service.ts:110-135` |
| BUG-04 | `HOLD` nạp `final_amount` (có ship), escrow chỉ `Σ subtotal` → phí ship kẹt vĩnh viễn | `payos.service.ts:511` vs `escrows.service.ts:71,80` |
| BUG-05 | COD không có bút toán nào — người bán không được cộng, hoặc `HOLD` âm | `orders.service.ts:596`, `orders.service.ts:993` |

### P1 — tồn kho

| # | Lỗi | Vị trí |
|---|---|---|
| BUG-06 | `updateStock` đọc-rồi-ghi không khoá → ghi đè kết quả trừ kho (lost update) | `catalog/products/products.service.ts:500-519` |
| BUG-07 | Chuyển `REFUNDED` không hoàn kho; và nhánh refund **không bao giờ chạy được** | `orders.service.ts:1079-1082`, `order-status.policy.ts:71-77` |
| BUG-08 | `DELETE /orders/:id` — người mua xoá đơn ở mọi trạng thái, không hoàn kho, escrow treo | `orders.service.ts:1234-1238` |
| BUG-09 | `cancelSale` huỷ **cả đơn** nhiều người bán; hoàn kho cả món của người bán đã giải ngân | `orders.service.ts:1249`, `orders.service.ts:1160-1170` |
| BUG-10 | `sold_count` không bao giờ tăng; `status` không thành `sold`; mua được hàng `draft`/`rejected` | `orders.service.ts:130-180` |

### P2 — luồng đặt hàng

| # | Lỗi | Vị trí |
|---|---|---|
| BUG-11 | `order_code` = ngày + random 3 chữ số trên cột **UNIQUE** → trùng ở ~37 đơn/ngày → 500 | `orders.service.ts:214` |
| BUG-12 | `shipping_fee` lấy thẳng từ client khi thiếu mã GHN hoặc GHN lỗi → free ship | `orders.service.ts:195-209` |
| BUG-13 | `cartItem.product.id` bị deref trong nhánh `!product` → `TypeError` 500 | `orders.service.ts:140-144` |
| BUG-14 | Notification sau commit, không `try/catch` → 500 sau khi đã trừ kho → bấm lại = đơn đôi | `orders.service.ts:338` |
| BUG-15 | Tạo link thanh toán cho đơn **đã huỷ**; `orderCode = order.id` cố định → không tạo lại link được | `payos.service.ts:70-130` |
| BUG-16 | `product.price` đọc ngoài transaction, chỉ `stock` đọc lại dưới khoá | `orders.service.ts:170-176` |
| BUG-17 | `PATCH status=delivered` sau khi đã xác nhận từng lô → `release()` ném → 400 | `orders.service.ts:1079` |

### P3 — rò rỉ dữ liệu / phụ

| # | Lỗi | Vị trí |
|---|---|---|
| BUG-18 | `GET /escrows` không kiểm admin → lộ escrow cả sàn; `limit` không chặn | `money/escrows/escrows.controller.ts:17,33,45` |
| BUG-19 | `POST /ghn/create-order` ai đăng nhập cũng gọi, tạo vận đơn bằng tài khoản sàn | `ordering/ghn/ghn.controller.ts:53` |
| BUG-20 | `confirmShipmentReceived` không kiểm `is_paid`, không kiểm lô đã `DELIVERED` | `orders.service.ts:640-680` |
| BUG-21 | `getStats` cộng doanh thu cả đơn chưa ai trả tiền | `orders.service.ts:72-84` |
| BUG-22 | Giỏ hàng cộng dồn `quantity` không giới hạn, không so `stock`, không kiểm `status` | `ordering/carts/cart.service.ts:20-40` |

---

## 4. Danh sách test case

### 4.1 P0 — tiền

| ID | Tên | Bước | Kỳ vọng ĐÚNG | Thực tế `staging` | Lỗi |
|---|---|---|---|---|---|
| TC-P0-01 | Người mua không tự đánh dấu đã trả tiền được | Tạo đơn PAYOS → `payments.update(paymentId, {status:'success'}, buyer)` | Ném `Forbidden` · `order.is_paid` giữ `false` | Trả 200 · `is_paid = 1` · không bút toán nào | BUG-01 |
| TC-P0-02 | Escrow chỉ sinh ra khi tiền đã về | `createOrderEscrows(orderId)` lúc đơn chưa trả tiền | Không tạo escrow nào (hoặc ném) | Tạo escrow `HOLDING` | BUG-02 |
| TC-P0-02b | Không giải ngân được escrow chưa có tiền đối ứng | TC-P0-02 → `release(orderId, sellerId)` | Ném · `HOLD` giữ 0 · `AVL(seller)` giữ 0 | `AVL(seller) += N` · **`HOLD = −N`** | BUG-02 |
| TC-P0-02c | Chuỗi lấy hàng miễn phí (end-to-end) | create-link → `payments.update success` → seller confirm → buyer received | Chặn ở bước 2 | Chạy trót lọt, người bán được cộng tiền sàn trả | BUG-01+02 |
| TC-P0-03a | Trả bằng ví thì người bán vẫn được giải ngân | `payments.create({order_id, payment_method:'wallet'})` → confirm received | `AVL(seller)` tăng | `release()` trả `[]` — không escrow nào tồn tại | BUG-03 |
| TC-P0-03b | Huỷ đơn đã trả bằng ví thì tiền về lại ví | Trả bằng ví → `cancel()` | `AVL(buyer)` về như cũ | `refund()` ném `NotFound`, bị nuốt · tiền kẹt trong `HOLD` | BUG-03 |
| TC-P0-03c | Trả bằng ví thì đơn chuyển `confirmed` | Trả bằng ví → đọc lại đơn | `status == confirmed` như đường PayOS | vẫn `pending` — người bán không thấy đơn cần gói | BUG-03 |
| TC-P0-04a | Huỷ đơn đã trả tiền thì hoàn **đủ** số đã trả | PayOS webhook `final_amount` → `cancel()` | `AVL(buyer) == final_amount` | `AVL(buyer) == total_amount` — **thiếu đúng phí ship** | BUG-04 |
| TC-P0-04b | Đơn kết thúc trọn vẹn thì `HOLD` về 0 | Webhook → giải ngân đủ mọi người bán | `HOLD == 0` | `HOLD == shipping_fee`, không lối ra | BUG-04 |
| TC-P0-05a | COD giao xong thì người bán được cộng tiền | Đơn COD → confirmed → received | `AVL(seller)` tăng | `release()` no-op — không escrow | BUG-05 |
| TC-P0-05b | Admin đánh dấu COD đã trả không làm `HOLD` âm | `updateStatus({is_paid:true})` → received | `HOLD >= 0` | `HOLD = −N` | BUG-05 |

### 4.2 P1 — tồn kho

| ID | Tên | Bước | Kỳ vọng ĐÚNG | Thực tế `staging` | Lỗi |
|---|---|---|---|---|---|
| TC-P1-06 | `updateStock` không xoá dấu vết trừ kho | stock=10 → đọc entity → đặt đơn 3 món → `updateStock(10)` | `stock == 7` hoặc ném xung đột | `stock == 10` — 3 món đã bán quay về kho | BUG-06 |
| TC-P1-07a | Đơn hoàn tiền thì hàng về kho | `delivered` → `updateStatus({status:'refunded'})` (admin) | `stock` tăng lại | `stock` không đổi | BUG-07 |
| TC-P1-07b | Admin hoàn tiền được đơn đã giao | như trên | Thành công | Ném — không còn escrow `HOLDING` · nhánh `REFUNDED` chết | BUG-07 |
| TC-P1-08 | Không xoá được đơn đã trả tiền / đang giao | `remove(orderId, buyer)` trên đơn `confirmed`, `is_paid=1` | Ném | Soft-delete thành công · kho không hoàn · escrow treo | BUG-08 |
| TC-P1-09a | Người bán A không huỷ được phần của người bán B | Đơn 2 shop → `cancelSale(orderId, sellerA)` | Chỉ phần A bị huỷ | Cả đơn huỷ, kho B hoàn, escrow B refund | BUG-09 |
| TC-P1-09b | Không hoàn kho món đã giao và đã giải ngân | Nhận hàng của A → huỷ đơn | Kho A **không** tăng | Kho A tăng — hàng ảo | BUG-09 |
| TC-P1-10a | Mua xong `sold_count` tăng | Đặt 3 món | `sold_count == 3` | `sold_count == 0` — không chỗ nào ghi | BUG-10 |
| TC-P1-10b | Không mua được hàng chưa mở bán | Product `status='draft'` (và `rejected`) → đặt đơn | Ném | Tạo đơn bình thường | BUG-10 |

### 4.3 P2 — luồng đặt hàng

| ID | Tên | Bước | Kỳ vọng ĐÚNG | Thực tế `staging` | Lỗi |
|---|---|---|---|---|---|
| TC-P2-11 | 200 đơn trong một ngày không trùng `order_code` | Tạo 200 đơn liên tiếp | 200 đơn thành công | Trùng khoá UNIQUE → một số đơn ném 500 | BUG-11 |
| TC-P2-12 | Client không tự đặt phí ship | `create({shipping_fee: 0})`, bỏ trống mã GHN | Phí ship do server tính, hoặc ném | `shipping_fee == 0` được ghi thẳng vào đơn | BUG-12 |
| TC-P2-13 | Sản phẩm đã xoá còn trong giỏ → báo lỗi tử tế | Soft-delete product → `create()` | `BadRequest`/`NotFound` có câu chữ | `TypeError: Cannot read properties of null` → 500 | BUG-13 |
| TC-P2-14 | Notification hỏng không làm hỏng đơn | Mock `notifications.create` ném | Đơn tạo xong, trả 201 | Ném ra ngoài, client thấy 500 dù kho đã trừ, giỏ đã xoá | BUG-14 |
| TC-P2-15a | Không tạo được link thanh toán cho đơn đã huỷ | `cancel()` → `createOrderPaymentLink()` | Ném | Tạo link bình thường | BUG-15 |
| TC-P2-15b | Tạo lại link sau khi link cũ hết hạn | Gọi `createOrderPaymentLink` hai lần | Lần hai ra link mới | `orderCode` trùng → PayOS từ chối | BUG-15 |
| TC-P2-16 | Đổi giá giữa chừng không làm lệch đơn | Đọc giỏ → seller đổi giá → transaction chốt đơn | Đơn theo giá mới, hoặc ném | Đơn chốt theo giá đọc trước | BUG-16 |
| TC-P2-17 | Đặt `delivered` sau khi đã xác nhận từng lô | received từng lô → `updateStatus({status:'delivered'})` | 200 (no-op) | 400 "không tìm thấy escrow để giải ngân" | BUG-17 |

### 4.4 P3 — rò rỉ / phụ

| ID | Tên | Kỳ vọng ĐÚNG | Thực tế `staging` | Lỗi |
|---|---|---|---|---|
| TC-P3-18a | `GET /escrows` chỉ admin | 403 cho người thường | 200, trả escrow cả sàn | BUG-18 |
| TC-P3-18b | `limit` bị chặn trần | `limit=999999` bị ép về `MAX_PAGE_SIZE` | Nạp cả bảng | BUG-18 |
| TC-P3-19 | `POST /ghn/create-order` gắn với đơn của chính mình | 403 khi không liên quan | Tạo vận đơn tuỳ ý bằng tài khoản sàn | BUG-19 |
| TC-P3-20 | Không xác nhận nhận hàng khi đơn chưa trả tiền | Ném | Cho qua, kéo theo giải ngân | BUG-20 |
| TC-P3-21 | Doanh thu chỉ tính đơn đã trả tiền | Loại đơn `is_paid=0` | Cộng cả đơn chưa trả | BUG-21 |
| TC-P3-22 | Giỏ không vượt tồn kho | Ném hoặc ép về `stock` | Cộng dồn không giới hạn | BUG-22 |

---

## 5. Bốn spec đã viết

Tất cả chạy trên **MySQL thật** theo đúng khuôn `escrows.service.spec.ts`
(`npm run test:db` → `npm test`). Service dựng bằng tay; chỉ `GhnService`,
`PayosService`, `NotificationsService` là bản giả — vì chúng gọi ra mạng, không
phải vì tiện.

| File | Test case |
|---|---|
| `src/money/payments/tu-danh-dau-da-tra-tien.spec.ts` | TC-P0-01, 03a, 03b, 03c |
| `src/money/escrows/ky-quy-khong-co-tien.spec.ts` | TC-P0-02, 02b, 04a, 04b |
| `src/ordering/orders/dat-hang-va-ton-kho.spec.ts` | TC-P1-06, 07, 08, 10a, 10b · TC-P2-11, 12, 13, 14 · TC-P3-21 |
| `src/ordering/orders/giai-ngan-nhieu-nguoi-ban.spec.ts` | TC-P0-05b · TC-P1-09a, 09b · TC-P2-17 · TC-P3-20 |

### Chưa tự động hoá được

| Lỗi | Vì sao | Cách kiểm tạm |
|---|---|---|
| BUG-15 | Cần PayOS sandbox thật (tạo link hai lần, đơn đã huỷ) | Kiểm thủ công trên staging |
| BUG-16 | Cửa sổ TOCTOU về **giá** nằm giữa hai câu truy vấn, ép xen kẽ được nhưng bài kiểm sẽ đo bản chép chứ không đo mã thật | Đọc mã — `orders.service.ts:170-176` |
| BUG-18, BUG-19 | Là lỗi **phân quyền ở controller**, phải đi qua HTTP + guard; repo chưa có khuôn `supertest` cho Nest app | Gọi tay bằng token người thường |
| BUG-22 | `CartService` phụ thuộc `ProductsService` đầy đủ (cache, follows, shop) | Đọc mã — `cart.service.ts:20-40` |

---

## 6. Kết quả chạy

**Lệnh:** `npm run test:db && npx jest` · **Máy:** Windows 11, MySQL 8.4 trong Docker (`zoldify-test-mysql`, cổng 3307)

```
Test Suites: 4 failed, 16 passed, 20 total
Tests:       23 failed, 107 passed, 130 total
Time:        25.3 s
```

**23/23 test case mới ĐỎ. 107 test cũ vẫn xanh — không hồi quy.**

Cổng CI của chính bốn file spec này:

| Cổng | Kết quả |
|---|---|
| `npx tsc --noEmit` | sạch |
| `npm run lint:check` | **966 / mốc 966** — không thêm một nợ lint nào |
| `npm run boundaries:check` | 28 / mốc 28 — không đổi |

### Số đo từng lỗi

| Test case | Kỳ vọng | Thực tế đo được | Kết luận |
|---|---|---|---|
| TC-P0-01 | ném | trả về `{"status":"success", order:{"is_paid":1}}`, `COUNT(ledger_transactions) = 0` | **BUG-01 xác nhận** |
| TC-P0-02 | 0 ký quỹ | 1 ký quỹ `holding` 500.000đ trên đơn chưa trả tiền | **BUG-02 xác nhận** |
| TC-P0-02b | `escrow_hold ≥ 0` | **`escrow_hold = −500.000`** | **BUG-02 xác nhận — tiền tự sinh** |
| TC-P0-03a | ≥ 1 ký quỹ | 0 | **BUG-03 xác nhận** |
| TC-P0-03b | hoàn 530.000 về ví | `NotFoundException: Không tìm thấy escrow nào để hoàn tiền` | **BUG-03 xác nhận — tiền kẹt** |
| TC-P0-03c | đơn → `confirmed` | vẫn `pending` | **BUG-03 xác nhận** |
| TC-P0-04a | ví người mua 530.000 | **500.000** — thiếu đúng 30.000 phí ship | **BUG-04 xác nhận** |
| TC-P0-04b | `escrow_hold = 0` | **30.000** đọng lại | **BUG-04 xác nhận** |
| TC-P0-05b | `escrow_hold ≥ 0` | **`−100.000`** sau một đơn COD | **BUG-05 xác nhận** |
| TC-P1-06 | kho 47 | **50** — 3 món đã bán quay về kho | **BUG-06 xác nhận — lost update** |
| TC-P1-07 | kho hoàn lại | `BadRequestException: … hoàn tiền ký quỹ thất bại: Không tìm thấy escrow nào để hoàn tiền` · trạng thái đơn ĐÃ lưu `refunded` | **BUG-07 xác nhận — đơn ghi là đã hoàn tiền nhưng không hoàn đồng nào, kho không về** |
| TC-P1-08 | ném | xoá mềm thành công trên đơn `confirmed`, `is_paid=1` | **BUG-08 xác nhận** |
| TC-P1-09a | kho B giữ 19 | **20** — A huỷ luôn phần của B | **BUG-09 xác nhận** |
| TC-P1-09b | kho A giữ 19 | **20** — hàng đã giao, tiền đã giải ngân, vẫn cộng về kho | **BUG-09 xác nhận — hàng ảo** |
| TC-P1-10a | `sold_count = 3` | **0** | **BUG-10 xác nhận** |
| TC-P1-10b | ném | đặt được hàng `draft` | **BUG-10 xác nhận** |
| TC-P2-11 | 120/120 đơn | **8–16 đơn ném** mỗi lần chạy · `Duplicate entry 'ORD-20260921-746' for key 'orders.IDX_e462…'` | **BUG-11 xác nhận — ~7–13% đơn hỏng ở 120 đơn/ngày** |
| TC-P2-12 | phí ship ≠ 0 | **0** — đúng số client gửi | **BUG-12 xác nhận** |
| TC-P2-13 | không phải `TypeError` | `TypeError: Cannot read properties of null (reading 'id')` | **BUG-13 xác nhận** |
| TC-P2-14 | tạo đơn xong | ném ra ngoài sau khi kho đã trừ, giỏ đã xoá | **BUG-14 xác nhận** |
| TC-P2-17 | 200 | ném `BadRequestException` | **BUG-17 xác nhận** |
| TC-P3-20 | ném | cho qua, giải ngân cho người bán trên đơn chưa trả tiền | **BUG-20 xác nhận** |
| TC-P3-21 | doanh thu 0 | **100.000** từ một đơn `pending` chưa ai trả | **BUG-21 xác nhận** |

**17/22 lỗi đã chứng minh bằng test đỏ.** Năm lỗi còn lại (BUG-15, 16, 18, 19, 22)
vẫn ở mức "đọc mã thấy", chưa có bài kiểm — xem mục 5.

### Chuỗi nguy hiểm nhất, ghép từ ba lỗi đã chứng minh

```
BUG-02  POST /payos/create-link          → ký quỹ holding, chưa ai trả tiền
BUG-01  PATCH /payments/:id {success}    → orders.is_paid = 1, sổ cái trống
BUG-20  PATCH /orders/:id/shipments/:s/received
                                         → escrow_hold = −500.000, ví người bán +500.000
        POST /withdrawals                → tiền thật rời ngân hàng của sàn
```

Chỉ cần một tài khoản người mua bình thường. Không bước nào đòi quyền admin.

---

## 7. Nghiệm thu — 24/09/2026

**Nhánh:** `fix/luong-mua-ban` (tách từ `staging` @ `2562975`)

```
Test Suites: 20 passed, 20 total
Tests:       130 passed, 130 total
Lint:        962 / mốc 962   (hạ từ 966 — dọn kèm 4 vấn đề)
Boundaries:  28 / mốc 28
Build:       nest build sạch
```

**23/23 bài kiểm đỏ → xanh. 107 bài kiểm cũ vẫn xanh. 17/17 lỗi đã vá.**

### Diễn biến từng bước

| Commit | Lỗi vá | Đỏ → Xanh |
|---|---|---|
| `997b3fb` | *(bài kiểm đỏ, commit riêng)* | 23 đỏ / 107 xanh |
| `8dd42e8` | BUG-01 tự đánh dấu đã trả tiền | 22 / 108 |
| `936e40f` | BUG-02 ký quỹ khi chưa có tiền | 20 / 110 |
| `3001363` | BUG-20 xác nhận nhận hàng khi chưa trả | 19 / 111 |
| `ec1e63c` | BUG-08 · BUG-10 · BUG-13 | 15 / 115 |
| `c3d783e` | BUG-06 `updateStock` lost update | 14 / 116 |
| `f58369b` | BUG-03 ví · BUG-04 phí ship | 9 / 121 |
| `63bf1ef` | BUG-11 · 12 · 14 · 17 · 21 | 4 / 126 |
| `f1c7b72` | BUG-07 hoàn tiền đơn đã giao | 3 / 127 |
| `01f8df6` | BUG-09 đơn nhiều người bán | 1 / 129 |
| `86144c4` | BUG-05 thu tiền ngoài cổng | **0 / 130** |

### Ba quyết định nghiệp vụ, do trưởng nhóm chốt 24/09

| Câu hỏi | Trả lời của Đạt | Đã làm |
|---|---|---|
| Phí ship trong két về đâu khi huỷ? | *"Tiền ship bên mua bán họ tự trả chứ sàn k thu tiền"* | Sàn cầm hộ rồi chuyển đi nguyên vẹn; phí sàn **không** tính trên phí ship. Thêm cột `escrows.shipping_amount` (migration `1787500000000`) |
| Trả bằng ví có tự chuyển `confirmed`? | *"Có chứ"* — *"Confirmed là trạng thái đã trả đợi giao hàng"* | Ví đi đúng bốn bước như PayOS, trong một transaction |
| COD ghi sổ ở bước nào? | *"đồ án thì khỏi quan tâm"* · *"Kh có đặt thật được"* | Chỉ giữ bất biến `escrow_hold` không âm. Đối soát COD đầy đủ ghi vào *Limitations* |

### Sáu bài kiểm được chỉnh, nói rõ để soi lại

Không bẻ test cho vừa code — cả sáu đều **siết chặt hơn** hoặc **mô tả đúng hợp đồng hơn**:

| Bài kiểm | Trước | Sau | Vì sao |
|---|---|---|---|
| TC-P0-02 | "không tạo dòng nào" | **ném** *và* không sót dòng nào | Lặng lẽ không làm gì thì người gọi tưởng đã xong |
| TC-P0-02b | gọi trần | bọc `.catch()` | Bài kiểm đo **số dư còn lại**, không đo lời gọi |
| TC-P1-06 | "kho phải là 47" | **ném** *và* ba món đã bán vẫn được trừ | `updateStock` nay từ chối thay vì đè |
| TC-P2-12 | "gửi 0 thì phí khác 0" | gửi 999.999 và khẳng định **không lọt**, `final_amount` khớp | Vấn đề là client cầm quyền định giá, không riêng ship miễn phí |
| TC-P1-09a | "kho B giữ nguyên" | **ném** *và* kho B giữ nguyên *và* đơn không bị huỷ | Cơ chế là từ chối, không phải huỷ đúng phần |
| `escrows.service.spec.ts` *(cũ)* | "gọi lại phải ném" | no-op im lặng, **số dư vẫn không nhúc nhích** | Chính comment của nó ghi thứ bắt buộc là số dư |

### Nợ kỹ thuật cố ý để lại, đã ghi trong mã

1. **Huỷ bán theo từng người bán** — `cancelSale` nay **chặn** đơn nhiều shop thay vì huỷ nhầm phần người khác. Huỷ đúng phần cần trạng thái ở mức `order_items`, tức đổi lược đồ + đổi cách tính `final_amount` + đổi ba client. Gỡ nợ khi có cột đó.
2. **Đối soát COD** — mới giữ bất biến két không âm; chưa có bước xác nhận GHN đã chuyển khoản thật, chưa có trang đối soát.
3. **`shipping_fee` trong DTO** — đã bị bỏ qua nhưng chưa gỡ khỏi `CreateOrderDto`, vì `forbidNonWhitelisted: true` sẽ làm frontend đang gửi trường đó nhận 400. Gỡ sau khi frontend thôi gửi.
4. **Ký quỹ đơn cũ** — bản ghi có trước migration để `shipping_amount = 0`, phí ship của chúng vẫn kẹt. Câu SQL đối soát ghi trong migration.

### Còn lại — chưa tự động hoá

BUG-15 (PayOS sandbox), BUG-16 (TOCTOU giá), BUG-18/19 (phân quyền controller,
cần khuôn `supertest`), BUG-22 (giỏ hàng). Xem mục 5.

---

## 8. Việc tiếp theo

1. Mở PR `fix/luong-mua-ban` → `staging`. Phần `src/money/` cần **Đạt duyệt**.
2. Bổ sung khuôn `supertest` cho Nest app để phủ nốt BUG-18 và BUG-19.
3. Đổ 23 test case vào `TestCaseTemplate.xlsx` làm phụ lục chương IV của báo cáo.
