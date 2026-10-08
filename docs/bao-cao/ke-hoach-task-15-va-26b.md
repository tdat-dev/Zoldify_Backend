# Kế hoạch — task #15 (gợi ý sản phẩm) và #26b (tồn kho real-time)

**Ngày:** 02/10/2026 · **Vai:** B (cả hai task, bảng phân công dòng 198 và 214)
**Vì sao làm:** hai ô **Level 3** còn trống trong thang điểm của thầy.

> | 15 | Gợi ý sản phẩm | SQL trên bảng `interactions` đã có, **không cần ML** | 21/08 | 23/08 | B |
> | 26 | Webhook GHN + **tồn kho real-time** | AD-03 ô T3 | 28/08 | 30/08 | B |

---

## 0. Kết luận quan trọng nhất: **hai task này KHÔNG làm cùng lúc được**

| | Chạm vào file nào | Xung đột với 46 commit chưa hoà của Đạt |
|---|---|---|
| **#15** | **toàn file mới** + 1 dòng `app.module.ts` | **gần như không** — Đạt không đụng `app.module.ts` |
| **#26b** | bắt buộc sửa `orders.service.ts` **và** `products.service.ts` | **cao** — cả hai đang nằm trong 7 file xung đột |

### Vì sao #26b không tránh được hai file đó

Ý tưởng sạch nhất là một **TypeORM EntitySubscriber** trên `Product`: nó bắt mọi
lần cột `stock` đổi mà không phải sửa service nào.

**Không dùng được.** Chỗ trừ kho chính không đi qua entity:

```ts
// orders.service.ts:480
stock: () => 'stock - :soLuong'
```

Đó là `QueryBuilder.update()` sinh SQL thô. EntitySubscriber **chỉ chạy với
`save()`/`remove()` trên entity**, nên đường trừ kho quan trọng nhất — lúc đặt
hàng — sẽ không phát sự kiện nào. Một hệ real-time im lặng đúng lúc cần nhất
còn tệ hơn không có, vì người dùng tin vào con số đang hiện.

Và dòng SQL thô đó **phải** giữ nguyên: nó là thứ chặn lost update, có
`check:race` R1 gác.

→ **Thứ tự bắt buộc: gộp xong mới làm #26b.** Làm trước là tự tay nhân đôi phần
xung đột mà tôi vừa mất hai hôm để lập bản đồ.

---

## 1. Task #15 — Gợi ý sản phẩm (làm được NGAY)

### 1.1 Hai endpoint

| Endpoint | Trả gì | Dùng ở đâu |
|---|---|---|
| `GET /products/:id/related` | sản phẩm liên quan tới một sản phẩm | trang chi tiết sản phẩm |
| `GET /recommendations/me` | gợi ý riêng cho người đang đăng nhập | trang chủ sau khi đăng nhập |

### 1.2 Thuật toán — SQL thuần, không ML, đúng như ô task ghi

**`/products/:id/related` — hai tầng, tầng sau đỡ tầng trước:**

1. **Người mua cùng mua** (item-to-item co-purchase). Tìm các đơn có chứa sản
   phẩm X, lấy những sản phẩm khác trong chính các đơn đó, đếm số lần xuất hiện,
   xếp theo số đếm giảm dần.
   ```
   order_items oi1  →  oi1.order_id = oi2.order_id  →  oi2.product_id ≠ X
   GROUP BY oi2.product_id ORDER BY COUNT(*) DESC
   ```
2. **Đỡ bằng cùng danh mục** khi tầng 1 trả về ít hơn `limit`: sản phẩm cùng
   `category_id`, xếp theo điểm đánh giá trung bình rồi tới số lượt bán.

**`/recommendations/me` — ba tầng:**

1. Co-purchase dựa trên các sản phẩm **người này đã mua**.
2. Danh mục họ mua nhiều nhất, sản phẩm điểm cao chưa mua.
3. Đỡ cuối: bán chạy toàn sàn trong 30 ngày.

Tầng đỡ là bắt buộc — tài khoản mới tinh không có lịch sử gì, và một trang gợi
ý rỗng ở ngay trang chủ trông như hỏng.

### 1.3 Ba luật bắt buộc, học từ lỗi đã có trong repo

| Luật | Vì sao |
|---|---|
| **Chỉ `status = ACTIVE`** | đúng lỗi `2752f41` đã phải vá ở danh sách công khai: thiếu lọc thì hàng bị từ chối, hàng nháp nằm lẫn vào |
| **Loại sản phẩm người dùng đã mua** khỏi `/recommendations/me` | gợi ý lại thứ vừa mua là quảng cáo ngược |
| **Chặn trần `limit`** | Epic 3 chặn limit toàn hệ; một `?limit=1000000` ở đây dựng cả triệu entity trong RAM một luồng JS |

### 1.4 Đo trước, không đoán

Hai truy vấn trên đều `JOIN` + `GROUP BY` trên `order_items` — bảng lớn nhất sau
`orders`. Trước khi viết service:

1. Dựng `zoldify_sqlaudit` (migration + `seed:products` + `seed:orders`).
2. Chạy `EXPLAIN` cho cả hai câu.
3. Thiếu index thì **viết migration**, không hạ yêu cầu. `check:index` gác đúng
   chuyện này và nó sẽ đỏ nếu tôi để lọt một câu quét toàn bảng.

Dự đoán cần: index ghép trên `order_items(product_id, order_id)` cho chiều tra
ngược. **Dự đoán, chưa đo** — sẽ xác nhận bằng `EXPLAIN` trước khi viết.

### 1.5 Cache

Dùng lại khuôn **khoá "đời"** đã có ở `products.service.ts` (xem comment trong
file đó). Gợi ý thay đổi chậm — tính lại mỗi request là trả tiền cho một câu trả
lời gần như không đổi.

Cache **fail-open**: Redis chết thì đọc thẳng DB, không chặn trang chủ.

### 1.6 File đụng tới

| File | Loại |
|---|---|
| `src/catalog/recommendations/recommendations.module.ts` | mới |
| `src/catalog/recommendations/recommendations.service.ts` | mới |
| `src/catalog/recommendations/recommendations.controller.ts` | mới |
| `src/catalog/recommendations/recommendations.service.spec.ts` | mới |
| `src/migrations/<ts>-AddCoPurchaseIndex.ts` | mới, **chỉ khi `EXPLAIN` đòi** |
| `src/app.module.ts` | +1 dòng |
| `openapi.json` | sinh lại |

**Không chạm** `products.service.ts`. Endpoint `/products/:id/related` khai trong
controller của module mới, Nest ghép đường dẫn — không cần sửa
`products.controller.ts`.

### 1.7 Bài kiểm (viết TRƯỚC, xác nhận ĐỎ)

| Ca | Kiểm gì |
|---|---|
| 1 | co-purchase xếp đúng thứ tự: sản phẩm xuất hiện cùng nhiều lần hơn đứng trước |
| 2 | **không trả về chính sản phẩm đang xem** |
| 3 | **chỉ trả hàng ACTIVE** — dựng một sản phẩm `rejected` trong cùng đơn, nó không được xuất hiện |
| 4 | tầng đỡ chạy khi co-purchase không đủ |
| 5 | `/recommendations/me` **loại sản phẩm đã mua** |
| 6 | tài khoản mới tinh vẫn nhận được danh sách (tầng đỡ cuối) |
| 7 | `?limit` khổng lồ bị chặn trần |

Ca 1, 3, 5 chạy trên **MySQL thật** — chúng kiểm câu SQL, mà SQL là thứ mock đi
thì không còn gì để kiểm. Ca 7 là logic thuần, repo giả.

### 1.8 Pre-mortem

| # | Rủi ro | Chặn bằng |
|---|---|---|
| 1 | Câu co-purchase quét toàn bảng → trang chi tiết sản phẩm chậm cho **mọi** người | `EXPLAIN` trước khi viết; `check:index` gác; cache |
| 2 | Gợi ý lộ hàng chưa duyệt / đã bị từ chối | lọc `ACTIVE`, có ca kiểm riêng |
| 3 | Tài khoản mới thấy trang rỗng | tầng đỡ cuối, có ca kiểm |
| 4 | Gợi ý chính shop của người đang xem (tự quảng cáo) | chưa chặn — **ghi nhận là giới hạn đã biết**, không sửa ngầm |
| 5 | Sản phẩm hết hàng vẫn được gợi ý | lọc `stock > 0` ở tầng 1 và 2 |

---

## 2. Task #26b — Tồn kho real-time (làm SAU khi gộp)

### 2.1 Thiết kế: Redis pub/sub, **không** phải socket trực tiếp

```
orders.service (trừ kho)   ─┐
products.service (sửa kho) ─┼→ StockPublisher.phat()  →  Redis channel `stock:changed`
worker (huỷ đơn, cộng kho) ─┘                                      │
                                                                   ↓
                              StockGateway (mỗi bản api) subscribe → emit tới room `product_<id>`
```

**Vì sao qua Redis chứ không gọi thẳng `server.emit`:** tiến trình `worker`
cũng đổi kho (`cancelExpired` cộng trả hàng về) nhưng **không có socket server
nào**. Gọi thẳng là mất hẳn sự kiện của mọi lần huỷ đơn tự động — và đó đúng là
lúc kho tăng trở lại, tức lúc người đang chờ hàng cần biết nhất.

Adapter Redis sẵn có (`redis-io.adapter.ts`) lo phần fan-out giữa 3 bản api.

### 2.2 Gateway namespace riêng

`@WebSocketGateway({ namespace: '/stock' })` — **file mới**, không đụng
`chat.gateway.ts` (Đạt vừa sửa +21 dòng ở đó).

Client `join` room `product_<id>` khi mở trang sản phẩm, `leave` khi rời. Không
phát toàn sàn: một sự kiện kho của sản phẩm X gửi cho mọi client là tự tạo một
trận bão broadcast.

### 2.3 Xác thực

Theo đúng khuôn `chat.gateway.ts`: token trong `handshake.auth`, sai thì
`disconnect()`. **Nhưng** xem kho là hành vi công khai (khách chưa đăng nhập
cũng xem trang sản phẩm), nên namespace này **cho phép khách** — và vì vậy nó
chỉ được phát **đúng một con số `stock`**, không kèm gì khác.

### 2.4 Ba chỗ phát sự kiện

| Chỗ | File | Dòng thêm |
|---|---|---|
| trừ kho khi đặt hàng | `orders.service.ts` | 1 |
| cộng kho khi huỷ | `orders.service.ts` | 1 |
| admin/người bán sửa kho | `products.service.ts` | 1 |

Mỗi chỗ đúng **một dòng** gọi publisher, đặt **sau khi transaction commit** —
phát trước khi commit là nói với người dùng một con số có thể bị rollback.

### 2.5 Bài kiểm

| Ca | Kiểm gì | Cần gì |
|---|---|---|
| 1 | publisher → subscriber qua Redis thật, một vòng | Redis |
| 2 | chỉ client trong room `product_<id>` nhận được | Redis + 2 socket |
| 3 | phát **sau** commit, không phát khi transaction rollback | MySQL |
| 4 | worker (không có socket server) phát được | Redis |
| 5 | Redis chết → không ném lỗi, đặt hàng vẫn chạy (**fail-open**) | — |

Thêm `npm run check:stock` theo khuôn `check:audit`: dựng app thật, nối một
socket thật, gọi `POST /orders` thật, xác nhận socket nhận được con số mới.
Bài kiểm đơn vị chứng minh từng mảnh; bài này chứng minh **cả đường dây**.

### 2.6 Pre-mortem

| # | Rủi ro | Chặn bằng |
|---|---|---|
| 1 | Redis chết → đặt hàng chết theo | publisher bọc try/catch, fail-open, lỗi ra log máy chủ |
| 2 | Phát trước commit → người dùng thấy số bị rollback | phát sau commit, có ca kiểm |
| 3 | Bão broadcast | room theo sản phẩm, không phát toàn sàn |
| 4 | Rò thông tin qua socket công khai | chỉ phát `{product_id, stock}`, không gì khác |
| 5 | Xung đột với bản vá của Đạt | **làm sau khi gộp**, mỗi chỗ chỉ thêm 1 dòng |

---

## 3. Thứ tự thực hiện

| Bước | Việc | Chặn bởi |
|---|---|---|
| 1 | **#15** — làm ngay, toàn file mới | không |
| 2 | Gộp `origin/staging` (7 xung đột) | cần quyền chạy `git merge` |
| 3 | **#26b** — sau khi gộp | bước 2 |

Mỗi task theo đủ 6 bước: pull → pre-mortem (đã viết ở trên) → **bài kiểm đỏ
trước** → nhánh phụ → nghiệm thu bằng chính bài kiểm đó → xanh hết mới gộp.

Mỗi task một nhánh riêng: `feat/task-15-goi-y-san-pham`,
`feat/task-26b-ton-kho-real-time`.

---

## 4. Ngoài phạm vi, nói trước

- **Không** làm machine learning. Ô task ghi rõ *"không cần ML"*, và một mô hình
  không giải thích được là thứ không bảo vệ được trước hội đồng.
- **Không** đụng `chat.gateway.ts` — namespace riêng.
- **Không** sửa dòng SQL thô trừ kho ở `orders.service.ts:480`. Nó là thứ chặn
  lost update, `check:race` R1 gác nó.
- **Không** làm giao diện. Hai task này dừng ở API và sự kiện socket; phần màn
  hình thuộc vai C/D.
