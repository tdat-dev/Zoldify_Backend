# Gửi Đạt — soát bản hoà trước khi gộp vào `staging`

**Nhánh:** `merge/staging-07-10` · **Commit:** `b14fef5` · **Ngày:** 07/10/2026
**Người hoà:** Cường (vai B)

---

## Cần anh soát cái gì

Bản hoà đã **xanh hết bảy cổng** (`nghiem-thu.md`, 50/50 suite · 327/327 ca).
Nhưng nó chạm **13 chỗ trong vùng của anh** — `src/money/` và `src/ordering/` —
nên tôi không tự gộp vào `staging`.

Anh **không phải gỡ xung đột**. Việc đó xong rồi. Anh chỉ cần đọc 13 mục dưới
đây và nói "ừ" hoặc "không" từng mục.

Đọc nhanh thì xem **hai mục 🔴** trước — đó là hai chỗ tôi phải chọn một bên,
và hai lần chọn **ngược chiều nhau**.

```bash
git diff 2562975 b14fef5 -- src/money/ src/ordering/
```

---

## 🔴 1. `findByOrder` — tôi BỎ bản của mình, lấy bản anh

`src/money/escrows/escrows.service.ts`

| | |
|---|---|
| Bản tôi (25/09) | đọc **hết** ký quỹ của đơn → kiểm người gọi có là một bên không → trả về **tất cả** |
| Bản anh (28/09) | lọc ngay trong câu SQL, mảng `where` = OR |

Bản tôi hở ở đơn **nhiều người bán**: người bán A qua được phép kiểm (A đúng là
một bên của đơn), rồi nhận về cả dòng của người bán B — số tiền, phí sàn. Trên
sàn C2C thì B là đối thủ trực tiếp của A.

Bản anh không có lỗ đó, và `SAFE_PARTY` chặn nốt email/sđt. **Lấy bản anh**, và
tôi xoá luôn phần kiểm-sau-khi-đọc của mình vì nó thành mã chết — giữ lại thì
người đọc sau tưởng còn một lớp bảo vệ nữa.

**Hệ quả có thể anh chưa lường:** người ngoài giờ nhận **mảng rỗng** thay vì lỗi
403. Tôi cho là kín hơn (một lỗi 403 còn xác nhận "đơn này có tồn tại"), và đã
sửa `quyen-xem-ky-quy.spec.ts` theo. Nếu anh muốn giữ 403 thì nói, đổi lại dễ.

---

## 🔴 2. `shippingFee` — tôi GIỮ bản của mình

`src/ordering/orders/orders.service.ts`

```ts
// bản anh
let shippingFee = Number(createOrderDto.shipping_fee ?? 0);
// bản tôi
let shippingFee = 0;
```

Khối tính phí ngay dưới là **của anh**, tôi giữ nguyên:

```ts
if (createOrderDto.ghn_district_id && createOrderDto.ghn_ward_code) {
  ... if (!quote.ok) throw new BadRequestException(...);   // H-07
  shippingFee = quote.total;
}
```

Vấn đề: hai trường GHN đó đều `@IsOptional`. Client **bỏ trống cả hai** thì khối
`if` không chạy, và với khởi tạo của anh thì `shippingFee` còn nguyên số client
gửi — kể cả `0`.

Hai bản vá phủ **hai lỗ khác nhau**:

| | phủ trường hợp |
|---|---|
| H-07 (anh) | **có** địa chỉ GHN mà tính phí lỗi → từ chối đơn |
| TC-P2-12 (tôi) | **không** gửi địa chỉ GHN → không cho client tự khai phí |

Giữ khởi tạo `0` thì cả hai cùng sống. Đây là mục tôi mong anh xác nhận kỹ nhất,
vì nó chạm đúng phần phí vận chuyển anh vừa làm.

> **Còn một lỗ nhỏ chưa ai vá:** client bỏ trống địa chỉ GHN thì phí ship = 0 và
> đơn **vẫn tạo được** (miễn phí ship). Đúng ra cũng nên từ chối như H-07. Tôi
> không sửa trong lần hoà này vì nó là thay đổi hành vi, không phải hoà. Anh
> quyết có làm không.

---

## 🟠 3. `OrdersService.remove()` — một bất biến vừa chết

`src/ordering/orders/orders.service.ts`

Comment cũ của tôi, viết 25/09:

> *"Người gọi ở đây đã qua `findOne(id, user)` nên **chắc chắn là người mua của
> đơn hoặc admin**"*

**Câu đó không còn đúng** từ khi anh mở `findOne` cho người bán xem đơn (H-02).
Người bán đi lọt qua, rơi xuống phép kiểm trạng thái và nhận:

```
"Đơn hàng đang ở trạng thái pending nên chưa xoá được..."
```

Tức hệ thống **mách cho người bán rằng cứ đợi đơn kết thúc là xoá được** đơn của
người khác. Bài kiểm `seller-orders.spec.ts` của anh bắt đúng chỗ này — nó kỳ
vọng `NotFoundException`, và nó đúng.

Sửa: `remove()` tự gọi `findOneForActor` và đòi `ADMIN` hoặc `BUYER`; người bán
nhận 404 như người ngoài, cùng lý do với `findOneForActor`.

Không bên nào tự thấy được lỗi này. Anh mở quyền xem mà không biết có hàm dựa
vào giả định cũ; tôi viết giả định đúng tại thời điểm viết. Nó chỉ lộ vì **bài
kiểm của anh chạy trên mã của tôi**.

---

## 🟢 4–8. Gộp cả hai bên, không ai mất gì

| Chỗ | Của anh | Của tôi |
|---|---|---|
| `escrows.service.ts` import | `UserRole`, `SAFE_PARTY` | `normalizePagination` |
| `escrows.service.ts` truy vấn | `select: { buyer: SAFE_PARTY, seller: SAFE_PARTY }` | `skip: offset, take: size` |
| `escrows.controller.ts` | `assertSelfOrAdmin` ở **cửa** | truyền `user` xuống **két** |
| `escrows.service.ts` ba hàm còn lại | — | `chiAdmin` / `adminHoacChinhChu` |

Về `escrows.controller.ts`: tôi giữ **cả hai lớp**. Lớp cửa cho 403 sớm và rõ;
lớp két chặn khi có cửa thứ hai mở ra sau — một job, một script, một controller
khác. Nếu anh thấy thừa thì bỏ lớp nào cũng được, nhưng tôi khuyên giữ két.

---

## 🟢 9. `payments.service.ts` — lấy trọn bản anh

Bản anh **chặt hơn** bản tôi: ngoài kiểm admin, nó còn cấm tay chuyển sang
`SUCCESS` và không ghi vào bảng `orders` nữa. Tôi bỏ bản mình.

Một chi tiết: tôi phải gộp lại dòng `import` vì lấy bản anh làm mất `DataSource`
và `OrderStatus` mà chỗ khác trong file còn dùng — build đỏ 2 lỗi, gộp import là
xanh.

---

## 🟡 10–12. Ba bài kiểm của anh phải chỉnh

**Không phải lỗi của anh** — trên nhánh anh chúng xanh. Chúng đỏ vì gặp luật của
nhánh tôi:

| Bài kiểm | Vì sao đỏ | Sửa |
|---|---|---|
| `ghn-fee-shipment.spec.ts` | fixture sản phẩm thiếu `status: 'active'`; luật TC-P1-10b của tôi chặn trước | thêm `status` vào fixture |
| `seller-orders.spec.ts` | như trên (2 chỗ), **và** `qb.getMany()` thiếu cột `price` — luật TC-P2-16 đọc lại giá dưới khoá, `Number(undefined)` = `NaN` | thêm `status` + `price` |
| `escrows-access.spec.ts` | gọi `findBySeller`/`findAll` thiếu tham số `user` mới | truyền `admin` |

Cả ba chỉ sửa **dữ liệu dựng sẵn**, không chạm mã sản xuất của anh.

Đáng chú ý: cả ba đều **đỏ vì một lý do chẳng liên quan tới thứ chúng đo**. Ca
"mỗi người bán nhận một thông báo" đo thông báo, lại chết vì kiểm giá. Tôi ghi
câu đó vào comment ở mỗi chỗ vá.

---

## 🟡 13. Hai dịch vụ mới thiếu trần RAM

`check:compose` bắt `backup` và `offsite` chưa có `mem_limit`. Đã thêm
`128m` / `192m` kèm lý do (mysqldump `--quick` chảy theo luồng; rclone phình
theo `--transfers` × chunk).

Tổng trần cụm **3520M ≤ ngân sách 4096M**.

---

## Số đo

```
test     50/50 suite · 327/327 ca      (nhánh tôi trước khi hoà: 38 / 255)
lint     521                            (tôi 507 · anh 943 — ĐO LẠI trên cây gộp)
openapi  107 route · 66 schema          (trước: 103 / 64)
build · check:boot · check:audit · check:compose   EXIT 0
```

Về mốc lint 521: tôi **đo lại**, không chọn bên nào. 14 điểm chênh so với 507
nằm rải trong 76 file, phần lớn là `no-unsafe-*` trong mã của anh
(`products.service` 61, `orders.service` 34, `payos` 27, `chat.gateway` 26).
Chỉ 3/26 chỗ ở `chat.gateway` sửa được bằng `--fix`, phần còn lại phải sửa tay
nên tôi để lại cho một đợt dọn riêng — không tự chạm mã anh.

---

## Một chuyện về git, anh cần biết

Lịch sử cục bộ bên tôi **bị xoá sạch hôm 05/10** và không phục hồi được. Nhưng
commit `2562975` (21/09 — điểm ta tách nhánh) vẫn còn trong kho object vì nó là
tổ tiên của `origin/staging`. Tôi nối lại bằng:

```bash
git replace --graft 088acb9 2562975
```

Lệnh này **không viết lại gì**, và gỡ được bằng `git replace -d`. Nó chỉ làm
`merge-base` hoạt động trở lại.

**Với anh thì không ảnh hưởng gì**: commit hoà `b14fef5` có hai cha thật, nên
nội dung chia sẻ bình thường. Chỉ là nếu anh clone mới, phần lịch sử bên tôi
trước 05/10 sẽ không thấy — nó mất thật, không phải do ref thay thế.

---

# Bổ sung 07/10 — `check:drift` đỏ 7 dòng, và nó là lỗi có sẵn bên anh

Sau khi hoà, tôi dựng được database dev trên máy mình và chạy **sáu cổng chưa
ai chạy được từ lâu**. Bốn cổng xanh ngay (`check:constraints`, `check:index`,
`check:race`, `check:cache`). Hai cổng đỏ:

### `check:core` — thiếu dữ liệu, không phải lỗi mã

```
✗ FAIL  quy mô orders < 500k (chỉ 1)
```

Cần seed dữ liệu lớn. Môi trường, không tính.

### `check:drift` — 7 dòng lệch, **cần anh quyết**

```
TypeORM sẽ chạy 7 câu để kéo DB về khớp entity:
  ALTER TABLE `push_tokens` DROP FOREIGN KEY `fk_push_user`;
  DROP INDEX `uq_push_token` ON `push_tokens`;
  ALTER TABLE `push_tokens` ADD UNIQUE INDEX `IDX_869b4a9ba2c9e030aafc4b7dc7` (`token`);
  ALTER TABLE `push_tokens` CHANGE `created_at` ... timestamp(6) ...;
  ALTER TABLE `push_tokens` CHANGE `updated_at` ... timestamp(6) ...;
  ALTER TABLE `addresses` CHANGE `is_default` `is_default` tinyint(1) NOT NULL DEFAULT '0';
  ALTER TABLE `push_tokens` ADD CONSTRAINT `FK_94c371aff70dedeb89dae39f440` ...;
```

**Năm dòng là `push_tokens`** — migration `1787670000000-CreatePushTokens.ts`
của anh khai:

```sql
`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
UNIQUE INDEX `uq_push_token` (`token`),
CONSTRAINT `fk_push_user` FOREIGN KEY (`user_id`) ...
```

còn entity khai `@CreateDateColumn({ type: 'timestamp' })` và không đặt tên
index/FK. TypeORM mặc định dùng `timestamp(6)` và tên băm của nó, nên nó muốn
sửa lại cả năm chỗ.

> **Đây đúng cái bẫy tôi đã dính** khi làm `admin_action_logs` (task #34):
> migration tạo `timestamp`, `@CreateDateColumn` đợi `timestamp(6)`, và
> `check:drift` đỏ 5 dòng. Lúc đó tôi sửa migration được vì nó chưa chạy ở đâu.

**Chỗ anh phải quyết:** migration này **đã chạy trên `api-staging` chưa?**

- **Chưa** → sửa thẳng file migration (đổi `timestamp` → `timestamp(6)`, bỏ tên
  index/FK tự đặt hoặc khai chúng trong entity bằng `@Index('uq_push_token')`).
- **Rồi** → **không được** sửa file cũ. Phải viết một migration MỚI chạy đúng 5
  câu `ALTER` ở trên.

Tôi không tự làm vì không biết câu trả lời, và đoán sai ở migration là loại sai
đắt nhất.

**Dòng thứ sáu** (`addresses.is_default`) đến từ việc hoà: tôi lấy entity của
anh (có transformer tinyint vá H-04) đặt cạnh migration `InitialSchema` cũ. Hai
bên mô tả cùng một cột theo hai cách, TypeORM thấy khác nhau.

### Chạy sáu cổng đó thế nào

Chúng đọc `src/data-source.ts` → `.env` `DB_*` (mặc định `zoldify_dev` ở 3306).
Trên máy không có MySQL dev, dựng tạm trong container test:

```bash
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "CREATE DATABASE IF NOT EXISTS zoldify_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

DB_HOST=127.0.0.1 DB_PORT=3307 DB_USERNAME=root DB_PASSWORD=testpw \
DB_DATABASE=zoldify_dev npm run migration:run

DB_HOST=127.0.0.1 DB_PORT=3307 DB_USERNAME=root DB_PASSWORD=testpw \
DB_DATABASE=zoldify_dev npm run check:drift
```
