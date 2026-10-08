# Kế hoạch bàn giao — backend Zoldify

**Viết ngày:** 05/10/2026 · **Người viết:** vai B (Cường)
**Dành cho:** người hoặc trợ lý AI thực hiện tiếp.

> **ĐỌC MỤC 0 TRƯỚC KHI LÀM BẤT CỨ VIỆC NÀO.** Nó là bảy cái bẫy đã làm hỏng
> việc thật trong dự án này. Bỏ qua nó thì bạn sẽ dính lại đúng từng cái một.

---

## 0. Bảy luật bắt buộc

### 0.1 Quy trình 6 bước, kể cả việc nhỏ

1. Pull `staging` mới nhất.
2. **Pre-mortem** — viết bảng rủi ro trước khi gõ dòng mã đầu tiên.
3. **Viết bài kiểm TRƯỚC, chạy nó, xác nhận nó ĐỎ.**
4. Làm trên **nhánh phụ** tách từ `staging`.
5. Nghiệm thu bằng **chính bài kiểm đó**.
6. Xanh hết mới gộp.

Bước 3 hay bị làm hình thức nhất. **Một bài kiểm không chuyển được từ đỏ sang
xanh thì không dùng để nghiệm thu được.**

### 0.2 Luôn chạy "ca đối chứng" sau khi viết test

Viết xong test và thấy nó xanh thì **chưa đủ**. Phải cố tình làm hỏng đúng cái
nó gác, chạy lại, và xác nhận nó **đỏ đúng số ca mong đợi**. Ví dụ đã làm:

```bash
# tắt bộ lọc status + stock trong recommendations.service.ts
# → đúng 2 ca đỏ (ca 3 và ca 4). Rồi trả lại mã gốc.
```

Không làm bước này thì bạn có một bài kiểm luôn xanh, và nó tệ hơn không có.

### 0.3 Database test bị nhiễm giữa các nhánh — dựng lại trước khi tin kết quả

Đã xảy ra: chạy `npm test` trên nhánh A tạo index `idx_seller_status_created`
trong `zoldify_test` qua `synchronize: true`; sang nhánh B (không có index đó)
synchronize đòi xoá, MySQL từ chối vì khoá ngoại → **48 test đỏ**, và suýt bị
báo cáo nhầm thành "staging hỏng".

```bash
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "DROP DATABASE IF EXISTS zoldify_test; CREATE DATABASE zoldify_test
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Chạy lệnh này mỗi khi đổi nhánh rồi mới chạy test.

### 0.4 Test phải chạy được LẦN HAI

Đã xảy ra: spec `wallets` đặt cứng id người dùng `9_000_000`, lần chạy đầu
xanh, lần hai **9 ca đỏ** vì số dư lần trước còn đọng lại.

Mỗi lần chạy phải dùng một dải id riêng:

```ts
const R = Math.floor(Math.random() * 100_000);
const ID = { nguoiBan: 7_000_000 + R, muaA: 7_100_000 + R };
```

**Không dọn bảng dùng chung** (sổ cái, products): jest chạy nhiều suite song
song trên cùng một database, xoá dữ liệu là giật thảm dưới chân suite khác.
Bảng chỉ một suite dùng (`settings`) thì `clear()` được.

### 0.5 Fixture thiếu cột NOT NULL làm cả suite đỏ giống hệt nhau

Đã xảy ra: spec gợi ý thiếu `receiver_name`, `receiver_phone`,
`shipping_address` của `orders` → cả 8 ca đỏ cùng một lỗi, rất dễ đổ oan cho
service. Khi **toàn bộ** ca trong một suite đỏ cùng một thông báo, nghi fixture
trước, nghi mã sau.

### 0.6 Bánh cóc lint chỉ được giảm, và phải ĐO lại

`npm run lint:check` có mốc cố định trong `scripts/check-lint.mjs`. Quy tắc:

- Thêm mã mới mà số tăng → **sửa mã của bạn**, không nâng mốc.
- Dọn được nợ cũ → hạ mốc xuống **đúng số vừa đo**, không chọn bừa.
- Gộp nhiều nhánh → đặt tạm `9999`, chạy `lint:check` để **đo**, rồi đặt đúng
  số đó. Bốn nhánh hạ xuống bốn số khác nhau (916/963/964/965), cây gộp đo ra
  **913** — không bằng nhánh nào.

Lỗi `prettier/prettier  Insert ␍` là do CRLF trên Windows. Sửa bằng
`npx eslint --fix <file>`, không sửa tay.

### 0.7 Đừng kết luận ở mức file khi mới đọc thống kê dòng

Đã xảy ra, và là lỗi nặng nhất trong đợt này: tôi viết *"payments: ưu tiên bản
Đạt"* dựa trên "Đạt +13 dòng, tôi +78 dòng". Đọc kỹ thì **hai bên sửa hai hàm
khác nhau** — lấy một bên là xoá bản vá của bên kia, và hậu quả là người bán
không nhận được tiền.

Khi đưa khuyến nghị, ghi rõ nó dựa trên cái gì:
*đã đọc hàm* → khuyến nghị · *mới đọc thống kê* → "chưa kiểm" · *suy ra* → nói
rõ là suy ra. **Với mã trong `src/money/` thì không khuyến nghị ở mức thấp hơn
"đã đọc hàm".**

---

## 1. Trạng thái hôm nay

| | |
|---|---|
| Nhánh làm việc | `staging` **cục bộ** — 63 commit chưa push |
| `origin/staging` | **53 commit** chưa hoà (Đạt vẫn đang làm) |
| Test | **239/239 xanh, 35 suite** |
| Cổng tự kiểm | 13 suite, tất cả xanh |
| Lint | 913 / mốc 913 |
| API | 101 route · 61 schema |
| Migration | 23 |

### Nhánh chưa gộp

| Nhánh | Nội dung |
|---|---|
| `staging` (cục bộ) | đã gộp 4 nhánh: 22 bản vá mua–bán, task #6, task #34, sơ đồ |
| `feat/task-15-goi-y-san-pham` | task #15, xong, 8 ca xanh |

---

## 2. Việc còn lại, theo thứ tự

### ⛔ A. Chặn đường — không phải việc mã

#### A1. Hoà `origin/staging` vào `staging` cục bộ

**Trạng thái:** chưa làm. 7 file xung đột, 10/17 khối nằm trong mã tiền.

**Cần người thật:**
- Lệnh `git merge` bị bộ phân loại an toàn của Claude Code chặn → người dùng
  phải tự gõ `!git merge --no-ff origin/staging` hoặc cấp quyền.
- Năm file tiền cần **Đạt duyệt** (vai A giữ `src/money/`).

**Cách gỡ từng file — đã đối chiếu ở mức hàm**, chi tiết trong
`docs/bao-cao/doi-chieu-hai-dot-soat-xet.md`:

| File | Quyết định |
|---|---|
| `payments.service.ts` | **giữ cả hai** — Đạt sửa `update()`, ta sửa `create()` |
| `escrows.service.ts` | giữ cả hai, **`findByOrder` lấy bản Đạt** (bản ta rò dòng của người bán khác trên đơn nhiều người bán) |
| `escrows.controller.ts` | giữ cả hai (guard controller + chữ ký có `user`) |
| `products.service.ts` | giữ cả hai — Đạt thêm lọc `condition` vào khoá cache |
| `address.entity.ts` | **lấy nguyên bản Đạt** — phía ta không đổi gì |
| `docker-compose.yml` | giữ cả hai, **nhớ thêm `mem_limit` cho dịch vụ `backup` mới** của Đạt, nếu không `check:compose` đỏ |
| `orders.service.ts` | ⚠️ **chỗ duy nhất phải viết lại tay** — xem dưới |

**`orders.service.ts` — chỗ rủi ro duy nhất.** Hai bên cùng sửa vùng tính phí
ship khi tạo đơn:
- Đạt (H-07): phí ship lỗi thì **từ chối đặt đơn**, thay vì âm thầm coi là 0đ.
- Ta: ký quỹ phải mang theo `shipping_amount`, cả bốn việc trong một transaction.

Hai ý **không mâu thuẫn** nhưng không dán hai khối cạnh nhau được. Phải viết
lại đoạn đó cho cả hai ý cùng đúng, rồi chạy **cả hai bộ bài kiểm**:
`dat-hang-va-ton-kho.spec.ts` (của ta) và bài H-07/H-08 (của Đạt).

**Nghiệm thu sau khi gộp:**
```bash
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "DROP DATABASE IF EXISTS zoldify_test; CREATE DATABASE zoldify_test ..."
npm run build && npm test          # phải xanh CẢ test cua Dat LẪN của ta
npm run check                      # 13 suite
npm run lint:check                 # đo lại mốc, đặt đúng số đo được
```

#### A2. Push và deploy

**Trước khi push, bắt buộc kiểm trên VPS:**
```bash
ss -ltnp | grep -E ':(80|443)'
```
Task #6 dựng `caddy` bind 80/443, mà `api.zoldify.com` đang chạy qua Cloudflare
— phải biết thứ gì đang giữ hai cổng đó. **Push vào `staging` là deploy ngay.**

---

### 🔨 B. Việc mã còn lại, xếp theo giá trị

#### B1. Task #26b — Tồn kho real-time · **ô Level 3** · LÀM SAU A1

Kế hoạch chi tiết đã có: `docs/bao-cao/ke-hoach-task-15-va-26b.md` mục 2.

Tóm tắt thiết kế đã chốt:
- **Redis pub/sub**, không gọi thẳng `server.emit` — vì tiến trình `worker`
  cũng đổi kho (`cancelExpired` cộng trả hàng) nhưng **không có socket server**.
- Gateway namespace riêng `/stock`, **file mới**, không đụng `chat.gateway.ts`.
- Room theo từng sản phẩm `product_<id>`, không phát toàn sàn.
- Chỉ phát `{product_id, stock}`, không kèm gì khác (namespace cho khách).
- Ba chỗ phát, mỗi chỗ **một dòng**, đặt **sau khi transaction commit**.

**Vì sao phải sau A1:** ba chỗ phát nằm trong `orders.service.ts` và
`products.service.ts` — hai file đang xung đột. Làm trước là tự tay gỡ xung đột
hai lần.

**Không được làm:** đừng thử dùng TypeORM `EntitySubscriber` cho việc này. Đã
kiểm: chỗ trừ kho chính đi bằng SQL thô (`orders.service.ts:480`
`stock: () => 'stock - :soLuong'`), mà subscriber chỉ chạy với `save()`/
`remove()` trên entity → đường trừ kho quan trọng nhất sẽ không phát gì. Và
dòng SQL đó **phải giữ nguyên**: nó chặn lost update, `check:race` R1 gác nó.

Thêm `npm run check:stock` theo khuôn `scripts/selfcheck-audit.ts`: dựng app
thật, nối socket thật, đặt đơn thật, xác nhận socket nhận con số mới.

#### B2. Task #35 — Trang admin đối soát ledger

Vai B. Chưa bắt đầu. Nội dung theo bảng phân công: *tổng đang giữ hộ · số dư hệ
thống · kết quả job đối soát*.

Đã có sẵn để dùng: `LedgerService.getBalance()` và `GET /admin/audit-logs` làm
mẫu cho route admin có phân trang.

> **Sửa 06/10.** Bản trước ghi còn có *"job đối soát mỗi giờ (task #32 của Đạt)"*.
> Tìm lại thì **job đó không tồn tại** — `grep -rniE "doi.?soat|reconcil"` chỉ ra
> `orders.service.ts:985 reconcileOrderDelivered`, là việc của MỘT đơn chứ không
> phải đối soát sổ cái. Nên trang này phải **tự tính tại chỗ**; thiết kế đã chốt
> nằm ở `docs/lenh/01-xoa-e2e-va-trang-doi-soat.md` việc B.

#### B3. Ba câu SQL mức CAO còn lại

| Chỗ | Vấn đề |
|---|---|
| `src/catalog/sitemap/sitemap.service.ts:65` | quét toàn bảng 2011 dòng |
| `src/catalog/products/products.service.ts:302` | bảng dẫn xuất + `DISTINCT` + filesort |
| `src/catalog/shop/shop.service.ts:110` | bảng dẫn xuất + `DISTINCT` |

Hai câu CAO khác (`admin.service.ts:137`, `orders.service.ts:80`) **đã xong**
bằng `bd156de`.

**Cách làm bắt buộc:** dựng `zoldify_sqlaudit`, chạy `EXPLAIN` **trước** khi
sửa, ghi lại số đo, sửa, `EXPLAIN` lại. Không đoán. `npm run check:index` sẽ
đỏ nếu để lọt một câu quét toàn bảng.

#### B4. `sql-audit.md` đang nói sai — sinh lại

File sinh ngày 21/09, **trước** `bd156de`, nên vẫn liệt kê 5 mức CAO trong khi
thực tế còn 3. **Đừng trích số từ file này vào báo cáo trước khi chạy lại.**

`npm run sql:audit` **chưa bao giờ chạy trọn** (56 route, quá giờ hai lần). ~~Lý
do đã biết: thiếu tài khoản `buyer@zoldify.com`, `seller@zoldify.com`,
`admin@zoldify.com` mật khẩu `123456` mà seed không tạo. Sửa seed trước.~~

> **Sửa 06/10 — ba dòng gạch ngang ở trên tôi viết SAI, đừng làm theo.** Kiểm
> lại `src/seed.ts`: cả ba tài khoản đều **có** — `seller@` dòng 50, `admin@`
> dòng 60, `buyer@` dòng 384, đều mật khẩu `123456`. Nên nguyên nhân thật
> **chưa biết**, phải chẩn đoán lại từ đầu trước khi giao việc này cho ai.

#### B5. Bốn lỗ mà **cả hai** đợt soát xét đều chưa chạm

| # | Lỗ | Chi tiết |
|---|---|---|
| 1 | `src/catalog/shop/shop.controller.ts:68` ném `new Error(...)` trần | NestJS trả **HTTP 500** chứ không phải 403. Chặn vẫn chặn nhưng báo sai mã và có thể lộ stack trace. Sửa thành `ForbiddenException`, và chuyển phép kiểm xuống service (controller là cửa, service là két) |
| 2 | **Không có endpoint refresh token** | `openapi.json` chỉ có login/register/logout/profile/firebase/change-password. Trong khi bảng phân công task #7 giao mobile làm *"TokenStore · refresh single-flight"* — app có thể đang gọi vào chỗ không tồn tại. **Hỏi C/D trước khi làm**, có thể là mobile cần sửa chứ không phải backend |
| 3 | `follows` thiếu `UNIQUE(follower_id, following_id)` | hai request song song tạo được hai dòng trùng. Hậu quả nhẹ (số đếm lệch 1). Cách sửa đúng là **thêm khoá UNIQUE**, không phải thêm kiểm tra trong mã. Đã có ca ghi nhận trong `follows.service.spec.ts` — khi thêm UNIQUE thì phải đổi ca đó thành "lần ghi thứ hai bị database từ chối" và chuyển sang MySQL thật |
| 4 | `view_count` đang tắt | `products.service.ts:503` có `TODO: re-enable khi có Redis`. Redis nay đã có → điều kiện gỡ nợ đã đủ. Làm theo đúng cách ghi trong TODO: Redis `INCR` + flush về MySQL theo lô, **không** `increment()` mỗi lượt xem |

#### B6. Ba module còn trắng test

| Module | Ghi chú |
|---|---|
| `firebase` | Đạt vừa sửa (+37 dòng) → **viết sau khi hoà**, nếu không là viết cho bản mã đã khác |
| `ghn` | Đạt vừa sửa (+51 dòng) → như trên |
| `files` | **Cố ý không viết.** Nó chỉ là CRUD uỷ quyền thẳng cho repository, không có bất biến nào. Phần logic thật (`public-url`) đã có spec riêng. Viết test cho nó là viết cho có |

#### B7. `test:e2e` chưa bao giờ chạy trong CI

Có đúng 1 file `test/app.e2e-spec.ts` nằm không; trong `ci.yml` cái tên đó chỉ
xuất hiện trong **một dòng comment**. `check:boot` có phủ phần "app dựng được",
nhưng e2e thì không ai chạy. Hoặc nối nó vào CI, hoặc xoá nó và ghi rõ vì sao.

---

### 📄 C. Ngoài backend, nhưng chặn việc bảo vệ

Không thuộc vai B, ghi ở đây để không ai quên:

1. **Báo cáo ≥50 trang, toàn tiếng Anh** — chưa bắt đầu. Dàn ý có sẵn ở
   `docs/bao-cao/dan-y-bao-cao-50-trang.md`.
2. **Slide theo mẫu** — chưa có file nào.
3. **`TestCaseTemplate.xlsx`** — còn trắng.
4. Hai repo frontend/admin có commit gần nhất cách đây lâu — thầy yêu cầu thấy
   thay đổi hàng tuần.

---

## 3. Số liệu dùng được cho báo cáo (đã đo, không phải ước lượng)

| | |
|---|---|
| Test | **239 bài · 35 suite**, chạy trên MySQL thật |
| Cổng tự kiểm | **13 suite**, nối CI |
| API | **101 route · 61 schema**, `openapi:check` gác trong CI |
| Database | **23 migration · 25 bảng · 34 khoá ngoại · 9 ràng buộc CHECK** |
| Hạ tầng | caddy + **api ×3** + worker; đo thật 90 request chia **31/35/32** |
| Rate limit | 10 req/s mỗi IP, đếm chung qua Redis — đo bằng hai client |
| Sơ đồ | **21 file nguồn + 21 ảnh export**, toàn tiếng Anh |
| Nợ lint | 913, bánh cóc chỉ giảm |

---

## 4. Lệnh hay dùng

```bash
# dựng database test
npm run test:db

# dựng lược đồ thật (cho check:index, check:boot, check:race, check:audit)
docker exec zoldify-test-mysql mysql -uroot -ptestpw \
  -e "CREATE DATABASE IF NOT EXISTS zoldify_schema
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run build
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USERNAME=root DB_PASSWORD=testpw \
DB_DATABASE=zoldify_schema \
  node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js

# chạy test
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_USER=root \
TEST_DB_PASSWORD=testpw TEST_DB_NAME=zoldify_test npm test

# 13 cổng tự kiểm
npm run check
```

---

## 5. Khi nào phải DỪNG và hỏi người

Không tự quyết ba loại việc sau:

1. **Bất cứ thay đổi nào trong `src/money/`** ngoài việc viết test. Vai A (Đạt)
   giữ phần này.
2. **Gỡ xung đột ở `orders.service.ts`** nếu hai bên sửa cùng một thân hàm với
   ý khác nhau. "Giữ cả hai" lúc đó không còn nghĩa gì, và đoán là sai kiểu im
   lặng.
3. **Push lên `origin/staging`** — đó là deploy, và nó cần kiểm cổng 80/443
   trên VPS trước.
