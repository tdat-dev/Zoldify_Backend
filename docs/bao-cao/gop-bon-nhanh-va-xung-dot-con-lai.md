# Gộp bốn nhánh, và 7 xung đột còn lại cần Đạt

**Ngày:** 02/10/2026 · **Vai:** B (Cường)
**Trạng thái:** 4 nhánh đã gộp vào `staging` **cục bộ**, xanh hết, **chưa push**.

---

## 1. Đã gộp — 57 commit, tất cả cổng xanh

| Nhánh | Commit | Nội dung |
|---|---:|---|
| `docs/khoi-phuc-so-do` | 8 | 18 sơ đồ nguồn + sửa 11 chỗ sơ đồ nói sai |
| `feat/task-6-caddy-mem-limit` | 9 | caddy · api ×3 · `mem_limit` · vá Firebase |
| `feat/task-34-nhat-ky-admin` | 6 | nhật ký hành động admin + `check:audit` |
| `fix/luong-mua-ban` | 29 | 22 bản vá luồng mua bán + bảo mật |

### Hai xung đột lúc gộp, cả hai cùng kiểu

**`package.json`** — bốn nhánh cùng thêm một npm script vào cùng một chỗ. Giữ
**cả bốn**: `check:compose` · `check:audit` · `check:constraints` · `check:drift`.

**`scripts/check-lint.mjs`** — bốn nhánh hạ bánh cóc xuống bốn số khác nhau
(916 · 963 · 964 · 965). **Không chọn bừa**: đặt tạm 9999 rồi **đo lại** trên
cây đã gộp → **913**. Thấp hơn mọi nhánh, vì bốn nhánh dọn bốn phần nợ khác nhau.

### Một lỗi tìm ra lúc nghiệm thu, đã vá

`check:drift` báo 5 dòng lệch: migration task #34 tạo `created_at` kiểu
`timestamp` trơn, trong khi `@CreateDateColumn` của TypeORM mong `timestamp(6)`.
Lệch kiểu này không làm test đỏ, không làm app đỏ — nó chỉ nổ vào lần kế ai đó
chạy `migration:generate`. Repo đã dính đúng bẫy này một lần
(`1787700000000-FixOrderShipmentsTimestampPrecision`). Đã sửa migration, dựng
lại lược đồ từ số không, chạy lại 23 migration: không lệch.

### Nghiệm thu trên cây đã gộp

| Cổng | Kết quả |
|---|---|
| `npm test` | **171/171 xanh, 27 suite** |
| `check:drift` | 0 dòng lệch |
| `check:constraints` · `check:index` · `check:audit` · `check:boot` · `check:race` | PASS |
| `check:ci` · `check:backup` · `check:redis` · `check:worker` · `check:cache` · `check:compose` | PASS |
| `lint:check` | 913 / mốc 913 |
| `boundaries:check` | 28 / mốc 28 |
| `openapi:check` | 99 route · 61 schema, không lệch |
| `drawio:check` · `diagrams:check` | 21 file · 26 sơ đồ, 0 lỗi |
| `build` | xanh |

Thêm một chỗ hở vá kèm: `ci.yml` có 4 cổng DB mới mà `npm run check` chỉ có 2 —
người chạy cục bộ thấy xanh rồi CI đỏ ở hai cổng họ không có cách nào chạy
trước. Nay `npm run check` chạy đủ **13 suite**.

---

## 2. 🔴 Việc đã đổi trong lúc tôi làm: Đạt đã promote production

Đo lại `origin` ngày 02/10:

| | 29/09 | **02/10** |
|---|---|---|
| production đi sau staging | 143 commit | **0** |
| staging đi sau production | 11 commit | 6 |

`origin/staging` đã đi từ `2562975` (21/09) tới `11ec934` (30/09) — **46 commit
mới của Đạt**, gồm: gộp prod vào staging, sửa luồng GHN (H-07/H-08), chép bản
sao lưu MySQL ra Cloudflare R2, vá quyền `DELETE /notifications/push-token`,
sửa `is_default` trả boolean, sửa key cache danh sách sản phẩm.

**Nghĩa là nhánh gộp của tôi đang dựa trên bản `staging` cũ 9 ngày.** Phải hoà
46 commit đó vào trước khi push.

---

## 3. 🔴 7 xung đột khi hoà `origin/staging` — 5 nằm trong mã tiền

Tôi đã thử gộp, đọc từng khối, rồi **huỷ merge**. Lý do ở mục 4.

| File | Khối | Tôi sửa | Đạt sửa | Gỡ thế nào |
|---|---:|---:|---:|---|
| `escrows.service.ts` | 4 | +371 | +21 | **giữ cả hai** |
| `escrows.controller.ts` | 2 | +27 | +24 | **giữ cả hai** |
| `payments.service.ts` | 3 | +78 | +13 | **giữ cả hai** — hai bên sửa hai hàm khác nhau (mục 3.2 đã sửa 02/10) |
| `orders.service.ts` | 1 | +413 | +179 | giữ cả hai (của Đạt là 3 hàm mới) |
| `products.service.ts` | 1 | +129 | +12 | giữ cả hai |
| `address.entity.ts` | 1 | 0 | +22 | **lấy bản Đạt** |
| `docker-compose.yml` | 5 | +139 | +76 | giữ cả hai |

### 3.1 Escrow — hai người vá **cùng một lỗ hổng** theo hai hướng khác nhau

Đây là chỗ quan trọng nhất, và là lý do không được gộp ẩu.

| | Cách vá |
|---|---|
| **Đạt** (audit B-03) | giới hạn **cột** trả ra: `SAFE_PARTY = {id, full_name, avatar}`, vì ba route đang lộ email + số điện thoại của mọi người mua/bán. Thêm `AdminGuard` ở controller cho route toàn sàn |
| **Tôi** (`f021036`) | thêm **kiểm quyền** trong service: `chiAdmin()`, `adminHoacChinhChu()` — vì bất kỳ ai đăng nhập cũng đọc được doanh thu đang giữ của shop bất kỳ |

**Hai bản vá bổ sung cho nhau, không thay thế nhau.** Đạt khoá cửa và che bớt
thứ bày ra; tôi khoá két. Bỏ bên nào cũng là mở lại một nửa lỗ hổng.

> **Bổ sung 02/10 — một chỗ KHÔNG phải "giữ cả hai".**
>
> `findByOrder` là hàm **cả hai cùng sửa**, và bản của tôi rò:
>
> - **Đạt** lọc hàng ngay trong SQL — người không phải admin chỉ nhận khoản mà
>   mình là bên mua hoặc bên bán.
> - **Tôi** đọc *tất cả* khoản của đơn, hỏi "người này có là một bên nào không",
>   có thì **trả tất cả**.
>
> Hệ này cho phép một đơn **nhiều người bán** (`UNIQUE(order_id, seller_id)`).
> Nên người bán A nhận được cả dòng của người bán B — số tiền, trạng thái, và vì
> nạp `relations: ['buyer','seller']` không giới hạn cột, kèm luôn email và số
> điện thoại.
>
> **→ `findByOrder` lấy bản của Đạt.** Phần còn lại của file vẫn giữ cả hai.

### 3.2 Payments — GIỮ CẢ HAI

> **Sửa ngày 02/10.** Mục này bản đầu ghi *"bản của Đạt mạnh hơn, nên ưu tiên —
> lấy bản của anh ấy"*. **Câu đó sai và nguy hiểm.** Gộp theo nó là xoá mất bản
> vá `create()` của tôi. Ai đọc tới đây xin đọc tiếp, đừng dùng bản cũ.

Hai bên sửa **hai hàm khác nhau** trong cùng một file:

| | Hàm | Việc |
|---|---|---|
| **Đạt** (A-01) | `update()` | chỉ admin; **cấm** đặt `SUCCESS` bằng tay; cấm sửa giao dịch đã `SUCCESS`; bỏ đoạn ghi `orders.is_paid` |
| **Tôi** | `create()` | trả bằng ví phải tạo **ký quỹ** và chuyển đơn sang `confirmed`, trong một transaction |

Lấy bản của Đạt đè lên nghĩa là mất bản vá `create()`, tức mở lại cái bẫy: trả
bằng ví thì không có bản ghi ký quỹ nào, `release()` về sau không tìm thấy gì để
giải ngân, và **người bán không bao giờ nhận được tiền của đơn đó**.

**→ Giữ cả hai.** Xung đột ở file này chỉ là import và dòng kề nhau.

Vì sao bản đầu sai: tôi đọc **thống kê diff** (ai sửa bao nhiêu dòng) rồi kết
luận ở mức file, trong khi một kết luận mức file đòi phải đọc tới mức **hàm**.
Chi tiết đối chiếu đầy đủ: `docs/bao-cao/doi-chieu-hai-dot-soat-xet.md`.

### 3.3 Ba file còn lại — cơ học

- **`address.entity.ts`**: phía tôi **không đổi gì** (0 dòng); Đạt thêm 3 cột
  GHN + transformer boolean cho `is_default`. Lấy nguyên bản của anh ấy.
- **`orders.service.ts`**: Đạt thêm **3 hàm mới** (`simulateGhnStatus`,
  `assertAllSellersShipped`, `retryGhnShipments`) — thuần cộng thêm. Chỉ có
  **1 khối** xung đột dù cả hai sửa nhiều, nên phần lớn đã tự gộp đúng.
- **`docker-compose.yml`**: Đạt thêm xoay vòng log (`x-logging`, 10m × 5 file)
  và một dịch vụ `backup`; tôi thêm caddy, `replicas`, `mem_limit`. Không đụng
  nhau về ý, chỉ đụng dòng. Lưu ý: dịch vụ `backup` mới **cũng cần `mem_limit`**,
  nếu không `check:compose` sẽ báo đỏ — và nó báo đúng.

---

## 4. Vì sao tôi dừng chứ không tự gỡ

`docs/BAN-GIAO.md` mục 4: *"Việc thuộc `src/money/` và bảo mật là của Đạt (vai A)."*

10 trong 17 khối xung đột nằm ở `escrows` · `payments` · `orders`. Gỡ chúng
nghĩa là chọn giữa logic tiền anh ấy **vừa viết tuần này** và logic tiền tôi
viết tuần trước — trong đúng cái hệ con đã từng cho phép lấy hàng miễn phí.
Gộp sai ở đây **không có triệu chứng**: test vẫn xanh, app vẫn chạy, chỉ có một
nửa bản vá biến mất.

Đổi lại, phần không đụng tiền thì tôi làm hết: 4 nhánh đã gộp xong, 13 cổng
xanh, bản đồ xung đột ở mục 3 để anh gỡ theo chứ không phải tự dò.

---

## 5. Việc tiếp theo, theo thứ tự

1. **Đạt gỡ 5 file tiền** theo mục 3 — ước chừng 30 phút, đã có sẵn chỉ dẫn
   từng file.
2. Chạy lại `npm run check` + `npm test` trên cây đã hoà (phải xanh cả bài kiểm
   của anh ấy lẫn của tôi).
3. **Trước khi push**: kiểm trên VPS `ss -ltnp | grep -E ':(80|443)'`. Nhánh
   task #6 dựng caddy bind 80/443, mà `api.zoldify.com` đang chạy HTTPS qua
   Cloudflare — phải biết thứ gì đang giữ hai cổng đó. Push vào `staging` là
   **deploy ngay**.
4. Thêm `mem_limit` cho dịch vụ `backup` mới của Đạt.
