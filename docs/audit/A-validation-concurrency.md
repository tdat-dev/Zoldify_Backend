# Audit A: Input Validation + Concurrency Control (Backend)

- Ngày: 2026-09-28
- Phạm vi: `Zoldify_Backend/src/**` (NestJS 11, TypeORM, MySQL 8), nhánh gốc `chore/soat-cau-hinh-payos-firebase` @ `15af965`
- Cách làm: 3 lượt rà song song (đặt hàng/tồn kho, luồng tiền, validation DTO), sau đó đọc lại code để kiểm chứng từng lỗi Critical/High. Chỉ audit, **chưa sửa dòng code nào**.
- Phạm trù: **Data Integrity** (toàn vẹn dữ liệu), thuộc nhóm lớn **Production Hardening**.

## Tóm tắt

| Mức | Số lỗi | Ý nghĩa |
|---|---|---|
| Critical | 7 | Mất tiền, lộ dữ liệu hoặc bán vượt tồn kho, xảy ra được ngay trong luồng bình thường |
| High | 11 | Cần điều kiện đặc biệt hơn (bấm song song, admin thao tác trùng) nhưng hậu quả nặng |
| Medium | 7 | Sai dữ liệu nhỏ, lỗi 500 thay vì 400, chỗ validation còn yếu |
| Low | 4 | Nên sửa khi tiện |

**Kết luận: chưa đủ an toàn để nhận tiền thật.** Lõi sổ cái (`ledger.service.ts`) làm đúng và chắc chắn. Vấn đề nằm ở các đường code **đi vòng qua sổ cái** hoặc **không khoá bản ghi** trước khi đổi trạng thái (đơn hàng, escrow, rút tiền, tồn kho).

Cột "Kiểm chứng": **Đã đọc lại** nghĩa là người viết báo cáo đã tự mở code và xác nhận. **Agent** nghĩa là agent rà đã đọc code và dẫn đúng dòng, nhưng chưa đọc lại lần hai.

---

## CRITICAL

### A-01. Người mua tự đánh dấu đơn "đã thanh toán" mà không trả tiền
- Vị trí: `src/money/payments/payments.controller.ts:54-59`, `src/money/payments/payments.service.ts:198-225`
- Kịch bản: người mua tạo đơn PayOS, có một bản ghi `Payment` trạng thái `PENDING` thuộc về mình. Gọi `PATCH /api/v1/payments/:id` với body `{ "status": "success" }`. Endpoint chỉ cần đăng nhập, `findOne` chỉ kiểm tra "payment này của bạn", rồi set `status = SUCCESS` và `orders.is_paid = true`. Không có đồng nào đi qua sổ cái, không có escrow. Người bán thấy đơn đã trả tiền và giao hàng thật.
- Sửa: bỏ quyền đổi `status` với người không phải admin (hoặc chặn cả endpoint bằng `AdminGuard`). Chỉ `PayosService.applyPaidPayment` và luồng admin xác nhận COD được phép set `is_paid = true`.
- Kiểm chứng: **Đã đọc lại**

### A-02. Bán vượt tồn kho (oversell)
- Vị trí: `src/ordering/orders/orders.service.ts:145-149` (kiểm tra), `:242-248` (trừ kho)
- Kịch bản: hàng C2C thường chỉ có 1 cái. Hai người cùng bấm đặt hàng, cả hai đọc `stock = 1` và qua được bước kiểm tra. Sau đó cả hai chạy `decrement()`, sinh ra `UPDATE ... SET stock = stock - 1` **không có** điều kiện `WHERE stock >= 1`. Kết quả: stock = -1 và có hai đơn cho một món hàng.
- Sửa: trừ kho bằng câu lệnh có điều kiện `UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty`, kiểm tra `affected === 1`, sai thì rollback cả đơn. Hoặc `SELECT ... FOR UPDATE` các dòng sản phẩm, sắp theo id như cách `ledger.service.ts:270-284` đang làm.
- Kiểm chứng: **Đã đọc lại**

### A-03. Tạo đơn không nằm trong transaction
- Vị trí: `src/ordering/orders/orders.service.ts:232-250`
- Kịch bản: lưu đơn, lưu dòng đơn, trừ kho từng món, xoá giỏ là 4 lệnh ghi riêng lẻ. Lỗi ở món thứ 2 (deadlock, mất kết nối) để lại một đơn `pending` dở dang: món 1 đã trừ kho, món 2 chưa, giỏ vẫn còn.
- Sửa: bọc toàn bộ khối trong `this.dataSource.transaction(...)`, giống cách `applyCancellation` (`:1039-1071`) đã làm đúng.
- Kiểm chứng: **Đã đọc lại**

### A-04. Bấm "Đặt hàng" 2 lần tạo ra 2 đơn
- Vị trí: `src/ordering/orders/orders.service.ts:98-103` (đọc giỏ), `:250` (xoá giỏ ở cuối)
- Kịch bản: double-click hoặc app tự retry khi timeout. Hai request đọc cùng một giỏ còn nguyên nên tạo ra 2 đơn và trừ kho 2 lần.
- Sửa: khoá các dòng giỏ bằng `SELECT ... FOR UPDATE` trong cùng transaction với A-03 (request thứ hai sẽ thấy giỏ đã trống), hoặc nhận header `Idempotency-Key` và lưu vào cột unique.
- Kiểm chứng: **Đã đọc lại**

### A-05. Escrow vừa giải ngân cho người bán vừa hoàn tiền cho người mua
- Vị trí: `src/money/escrows/escrows.service.ts:102-178` (`release`), `:194-243` (`refund`)
- Kịch bản: người mua bấm "đã nhận hàng" (gọi `release`) đúng lúc người bán huỷ đơn (gọi `refund`). Cả hai đọc escrow `HOLDING` bằng `em.find` thường, **không khoá dòng escrow**. Hai lệnh chỉ chờ nhau ở bước khoá tài khoản sổ cái. Idempotency key lại khác nhau (`escrow_release:` và `escrow_refund:`), nên lệnh chạy sau vẫn trừ `ESCROW_HOLD` thêm một lần. Tài khoản PLATFORM không bị chặn số âm (`ledger.service.ts:202`), nên cả người bán lẫn người mua đều nhận tiền và quỹ escrow bị âm vĩnh viễn.
- Sửa: đầu cả `release()` và `refund()` phải khoá dòng escrow bằng `setLock('pessimistic_write')` rồi kiểm tra lại `status === HOLDING`. Hoặc cập nhật có điều kiện `UPDATE escrows SET status = ... WHERE id = ? AND status = 'holding'` và kiểm tra số dòng bị ảnh hưởng.
- Kiểm chứng: **Đã đọc lại**

### A-06. Thanh toán bằng ví không tạo escrow, tiền người bán kẹt mãi
- Vị trí: `src/money/payments/payments.service.ts:107-134`
- Kịch bản: nhánh `WALLET` trừ ví người mua (tiền vào `ESCROW_HOLD`) và set `is_paid = true`, nhưng **không gọi** `escrowsService.createOrderEscrows`. Khi người mua xác nhận nhận hàng, `release(orderId, sellerId)` không tìm thấy escrow nào và trả `[]` (no-op), nên người bán không bao giờ được trả tiền. Có thể đây chính là nguyên nhân của thẻ "LỖI SẢN PHẨM: tiền kẹt trong escrow" trên board.
- Sửa: gọi `createOrderEscrows(orderId, em)` trong cùng transaction với `deduct()`. Khi đơn đã trả tiền mà không có escrow thì `release()` phải báo lỗi, không được lặng lẽ bỏ qua.
- Kiểm chứng: **Đã đọc lại**

### A-07. Nghe lén chat của người khác qua WebSocket
- Vị trí: `src/messaging/chat/chat.gateway.ts:78-81`
- Kịch bản: sự kiện `join_conversation` gọi thẳng `client.join('conv_' + id)` mà không kiểm tra người gọi có phải người mua hoặc người bán của cuộc chat đó không. Id cuộc chat là số tăng dần, nên ai đăng nhập cũng join được `conv_1..conv_N` và nhận mọi tin nhắn. (Tầng REST ở `chat.service.ts:125,163` có kiểm tra, riêng tầng WS thì không.)
- Sửa: tra cuộc chat, kiểm tra `client.data.user.id` là buyer hoặc seller rồi mới `join`.
- Kiểm chứng: **Đã đọc lại**

---

## HIGH

### A-08. Đổi trạng thái đơn bị ghi đè (lost update)
- Vị trí: `src/ordering/orders/orders.service.ts:431-495` (lệnh ghi ở `:479`); `Order` không có `@VersionColumn`
- Kịch bản: người mua huỷ đơn đúng lúc người bán bấm xác nhận, cả hai cùng đọc `pending`. Luồng huỷ commit trước: hoàn kho, hoàn tiền. Luồng xác nhận vẫn giữ object cũ và `save(order)` ghi đè lại thành `confirmed`. Đơn "đã xác nhận" để đi giao trong khi tiền đã hoàn và kho đã trả lại.
- Sửa: thêm `@VersionColumn()` vào `Order`, hoặc dùng `UPDATE orders SET status = :next WHERE id = :id AND status = :expected`; nếu không có dòng nào bị ảnh hưởng thì trả 409.
- Kiểm chứng: **Đã đọc lại** (không có VersionColumn, save cả entity)

### A-09. Escrow có thể bị tạo trùng
- Vị trí: `src/money/escrows/entities/escrow.entity.ts:21-24` (chỉ có index thường), `src/money/escrows/escrows.service.ts:58-63`, `src/money/payos/payos.controller.ts:53-58`
- Kịch bản: `createOrderEscrows` chống trùng bằng "đếm, nếu 0 thì chèn", không khoá, không có unique. Hai lần tạo link PayOS song song có thể chèn 2 bộ escrow. Mỗi escrow có id riêng nên idempotency key `escrow_release:{id}` cũng khác nhau, dẫn tới người bán có thể được trả 2 lần. Ngoài ra `payos.controller.ts` bọc lời gọi bằng `try/catch` nuốt **mọi** lỗi.
- Sửa: thêm `@Index('uq_escrow_order_seller', ['order', 'seller'], { unique: true })` (kèm migration). Chỉ nuốt đúng lỗi "đã tồn tại".
- Kiểm chứng: **Đã đọc lại** (thiếu unique)

### A-10. Tạo vận đơn GHN trùng khi xác nhận đơn song song
- Vị trí: `src/ordering/orders/orders.service.ts:902-1009` (kiểm tra ở `:918-922`)
- Kịch bản: hai request xác nhận cùng qua được bước "đã có vận đơn chưa", cả hai gọi API GHN thật (tạo 2 kiện, mất phí 2 lần). Unique `(order, seller)` chỉ chặn được lúc lưu dòng thứ hai, và lỗi đó còn bị ghi nhầm thành "GHN thất bại".
- Sửa: khoá dòng đơn (`FOR UPDATE`) trước khi quyết định tạo vận đơn. Tách riêng lỗi duplicate-key khỏi lỗi GHN.
- Kiểm chứng: Agent

### A-11. Admin duyệt rút tiền không có transaction hay khoá
- Vị trí: `src/money/withdrawals/withdrawals.service.ts:163-169`
- Kịch bản: admin A bấm duyệt đúng lúc admin B bấm từ chối. `reject()` đã trả tiền về ví, nhưng `approve()` ghi đè trạng thái thành `APPROVED`. Kế toán nhìn màn hình và chuyển khoản thật, trong khi người dùng vẫn còn tiền trong ví, tức là trả hai lần.
- Sửa: bọc trong transaction, load bằng `pessimistic_write`, kiểm tra lại `PENDING`, giống `reject()` và `complete()` đang làm.
- Kiểm chứng: **Đã đọc lại**

### A-12. Đăng sản phẩm giá âm được chấp nhận
- Vị trí: `src/catalog/products/dto/create-product.dto.ts:14-16`, dùng ở `src/ordering/orders/orders.service.ts:171, 204`
- Kịch bản: `POST /products { "price": -50000 }` qua được validation (chỉ có `@IsNumber`). Đơn chứa món này làm tổng tiền giảm hoặc âm, và không chỗ nào kiểm tra `final_amount > 0`.
- Sửa: `@Min(1)` cho `price` ở cả DTO tạo và DTO sửa. Kiểm tra `finalAmount > 0` trước khi lưu đơn.
- Kiểm chứng: Agent

### A-13. Phí ship lấy từ số client gửi lên
- Vị trí: `src/ordering/orders/orders.service.ts:188-201`
- Kịch bản: không gửi `ghn_district_id`/`ghn_ward_code` (hai trường này optional), hoặc GHN lỗi, thì server dùng `shipping_fee` do client gửi. Gửi `0` là được miễn phí ship.
- Sửa: không bao giờ tin `shipping_fee` từ client. Bắt buộc có mã GHN và tự tính, GHN lỗi thì chặn đặt hàng hoặc dùng bảng phí cố định phía server.
- Kiểm chứng: **Đã đọc lại**

### A-14. Ai đăng nhập cũng tạo được vận đơn GHN thật
- Vị trí: `src/ordering/ghn/ghn.controller.ts:52-56`
- Kịch bản: `POST /ghn/create-order` chỉ cần JWT, chuyển thẳng tên, địa chỉ và COD tuỳ ý sang API GHN thật. Kẻ xấu có thể spam tạo kiện hàng, tốn phí trên tài khoản GHN của sàn.
- Sửa: bỏ endpoint này (luồng thật đã đi qua `createGhnShipmentsPerSeller`), hoặc chỉ cho admin, hoặc buộc gắn với một đơn của chính người gọi.
- Kiểm chứng: **Đã đọc lại**

### A-15. Upload file: cho phép SVG, tin Content-Type client khai, giữ file lớn trong RAM
- Vị trí: `src/catalog/files/multer.config.ts:15-39`, `src/catalog/files/storage.service.ts:79`
- Đã có: lọc theo đuôi file, giới hạn 100MB/file, tối đa 10 file (cấu hình qua `MulterModule.registerAsync`).
- Còn thiếu:
  1. Danh sách cho phép có `svg`, trong khi SVG chứa được JavaScript. File được phục vụ công khai kèm `Content-Type` do client tự khai, nên dễ thành stored XSS trên domain ảnh.
  2. Chỉ kiểm tra đuôi tên file, không kiểm tra nội dung thật (magic bytes).
  3. `memoryStorage` + 100MB x 10 file = tối đa 1GB RAM cho mỗi request. Vài request song song là đủ làm sập server.
- Sửa: bỏ `svg` (hoặc ép `Content-Disposition: attachment`), tự xác định Content-Type từ magic bytes, hạ giới hạn xuống khoảng 5-10MB cho ảnh.
- Kiểm chứng: **Đã đọc lại** (agent ban đầu kết luận "không có giới hạn"; kết luận đó sai và đã được sửa ở đây)

### A-16. Admin sửa user nhận `any`, ghi được mọi cột
- Vị trí: `src/ops/admin/admin.controller.ts:66`, `src/ops/admin/admin.service.ts:108-114`
- Kịch bản: `@Body() dto: any` khiến ValidationPipe bỏ qua hoàn toàn. `PATCH /admin/users/:id { "password": "...", "role": "admin", "token_version": 0 }` ghi thẳng vào bảng `users`, không băm mật khẩu và vô hiệu hoá luôn whitelist vai trò ở endpoint `changeUserRole`. Phiên admin bị chiếm (XSS ở trang admin) là cài được cửa hậu.
- Sửa: tạo `UpdateAdminUserDto` chỉ cho phép một số trường; mật khẩu đi qua service băm.
- Kiểm chứng: **Đã đọc lại**

### A-17. Chuyển tiền ví: không chống trùng, không kiểm tra người nhận
- Vị trí: `src/money/wallets/wallets.controller.ts:75-84`, `src/money/wallets/wallets.service.ts:199-225`, `src/money/wallets/dto/transfer.dto.ts:6`
- Kịch bản: (1) mỗi lần gọi sinh idempotency key ngẫu nhiên, nên app retry là chuyển 2 lần. (2) `to_user_id` không tồn tại vẫn tạo tài khoản sổ cái mới và tiền mất vào đó. (3) `@IsNumber` cho phép `3.5`.
- Sửa: nhận `Idempotency-Key` từ client, kiểm tra user nhận tồn tại, dùng `@IsInt() @Min(1)`.
- Kiểm chứng: Agent

### A-18. Phân trang không có giới hạn tối đa (cả endpoint công khai)
- Vị trí: `src/catalog/products/products.service.ts:128-131` và lặp lại ở hầu hết endpoint danh sách (admin, users, orders, wallets, withdrawals, escrows, notifications)
- Kịch bản: `GET /api/v1/products?pageSize=5000000` không cần đăng nhập, quét gần hết bảng và trả JSON khổng lồ. Gọi vài lần là DB nghẽn.
- Sửa: tạo `PaginationQueryDto` dùng chung (`@IsInt() @Min(1) @Max(100)`), áp cho mọi endpoint danh sách.
- Kiểm chứng: Agent

---

## MEDIUM

| ID | Lỗi | Vị trí | Sửa |
|---|---|---|---|
| A-19 | Webhook PayOS không so sánh số tiền thực nhận (`webhookData.amount`) với số tiền của payment | `src/money/payos/payos.service.ts:424-483` | So sánh, lệch thì đánh dấu cần kiểm tra tay, không cộng tiền |
| A-20 | Body khai báo kiểu inline hoặc `Record<string,string>`, nên ValidationPipe không kiểm tra gì | `admin.controller.ts:60, 90`, `settings.controller.ts:39`, `orders.controller.ts:96`, `ghn.controller.ts:41-47` | Tạo DTO class cho từng endpoint; settings phải có whitelist key |
| A-21 | Không có `@MaxLength` nào trong toàn bộ code (0 kết quả). Chuỗi dài hơn cột DB gây lỗi 500 thay vì 400 | Mọi DTO có chuỗi, ví dụ `update-order.dto.ts:20-26` | Thêm `@MaxLength` theo độ dài cột trong entity |
| A-22 | `PATCH /auth/profile` nhận từng trường bằng `@Body('field')`, không có validation | `src/identity/auth/auth.controller.ts:189-194` | Dùng `UpdateProfileDto` |
| A-23 | Thêm vào giỏ: 2 request song song làm mất một lần cộng, hoặc báo 500 do trùng unique | `src/ordering/carts/cart.service.ts:27-39` | Dùng `increment()` hoặc `INSERT ... ON DUPLICATE KEY UPDATE` |
| A-24 | Sửa tồn kho ghi số tuyệt đối, có thể xoá mất lượt trừ kho của đơn vừa đặt | `src/catalog/products/products.service.ts:319-339` | Ghi có điều kiện `WHERE stock = :expected`, hoặc dùng tăng/giảm tương đối |
| A-25 | `stock` cho phép số âm/lẻ, `images` không kiểm tra mảng, `condition` không phải enum | `src/catalog/products/dto/create-product.dto.ts:57-66` | `@IsInt() @Min(0)`, `@IsArray() @IsString({each}) @ArrayMaxSize(10)`, `@IsEnum` |

## LOW

| ID | Lỗi | Vị trí | Sửa |
|---|---|---|---|
| A-26 | `order_code` chỉ có 3 số ngẫu nhiên mỗi ngày; trùng thì 500 | `orders.service.ts:207` | Thử lại khi trùng, hoặc dùng sequence |
| A-27 | Xác nhận nhận hàng song song: tiền vẫn an toàn nhờ idempotency key, nhưng request thua trả 500 | `orders.service.ts:511-555` | Bắt lỗi duplicate-key, trả 200 idempotent |
| A-28 | Cột `decimal` không có transformer (driver trả về string); cột `wallets.balance` và bảng `wallet_transactions` không còn ai dùng | `payment.entity.ts:30`, `escrow.entity.ts:40`, `wallet.entity.ts:21` | Thêm transformer; migration xoá cột chết |
| A-29 | SDK `@payos/node` so chữ ký bằng `!==`, không constant-time | `node_modules/@payos/node/lib/resources/webhooks/webhook.js:53` | Rủi ro thấp; có thể tự verify bằng `crypto.timingSafeEqual` |

---

## Những gì đã làm tốt

- **Sổ cái kép** `src/money/ledger/ledger.service.ts:100-224`: mỗi bút toán một transaction, khoá tài khoản bằng `FOR UPDATE` theo thứ tự id (tránh deadlock), `idempotency_key` unique trong DB, chặn số dư user âm, tiền lưu BIGINT. Đây là khuôn mẫu cần áp cho các chỗ khác.
- **Huỷ đơn** `orders.service.ts:1039-1071` (`applyCancellation`): hoàn tiền, đổi trạng thái và trả kho trong một transaction; mọi đường huỷ (người mua, người bán, cron) dùng chung một hàm.
- **Webhook PayOS** `payos.service.ts:424-634`: có verify chữ ký, chạy trong một transaction, key chống trùng dùng chung với luồng refresh thủ công, xử lý đúng ca "đơn đã huỷ mà tiền vẫn về" (trả vào ví người mua).
- **Gọi API ngoài sau khi commit** (`voidOpenPaymentLink`, `orders.service.ts:1079-1101`): không giữ khoá DB trong lúc chờ mạng.
- **Unique constraint** cho giỏ hàng `(user, product)` và vận đơn `(order, seller)`.
- **ValidationPipe toàn cục** (`whitelist`, `forbidNonWhitelisted`, `transform`), Helmet, CORS theo env, giới hạn body 5MB, throttle cho login/OTP/đổi mật khẩu.
- **Cron** `tasks.service.ts`: try/catch từng bản ghi và gọi lại đúng service có transaction.

---

## Đề xuất thứ tự sửa

**Đợt 1: chặn mất tiền (làm trước khi nhận tiền thật)**
A-01, A-05, A-06, A-11, A-09, A-13, A-12

**Đợt 2: chặn oversell và dữ liệu hỏng trong luồng đặt hàng**
A-02, A-03, A-04 (sửa chung một lần: transaction + trừ kho có điều kiện + khoá giỏ), A-08, A-10

**Đợt 3: bảo mật và validation**
A-07, A-14, A-15, A-16, A-17, A-18, A-20, A-21, A-22

**Đợt 4: dọn dẹp**
A-19, A-23 đến A-29

Mỗi lỗi Critical/High khi sửa nên kèm **một test chạy song song** (ví dụ `Promise.all` hai request đặt cùng món hàng stock = 1 và kiểm tra chỉ đúng một đơn thành công), vì hiện chưa có test nào cho race condition.
