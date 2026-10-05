# Tình trạng công việc — 28/09/2026

> **Mục đích của file này**: mở cuộc trò chuyện mới mà không phải nạp lại cả
> lịch sử. Đọc file này + `CLAUDE.md` + `docs/BAN-GIAO.md` là đủ để tiếp tục.
>
> Nhánh đang làm: **`fix/luong-mua-ban`** — 28 commit, đi trước `staging` 28,
> chưa mở PR. Cây làm việc sạch (chỉ còn `Project.txt` untracked — đề bài của
> thầy, cố ý không commit).

---

## 1. Đã xong những gì

Ba đợt, 22 lỗi đã vá, mỗi lỗi một commit riêng đúng quy tắc.

### Đợt A — luồng mua · thanh toán · tồn kho (17 lỗi)

Đầu đuôi ghi ở `docs/bao-cao/kiem-thu-luong-mua-ban.md` (22 lỗi + 28 test case
+ kết quả nghiệm thu). Chuỗi nặng nhất là ba lỗi ghép lại thành **lấy hàng
miễn phí chỉ với một tài khoản người mua thường**:

```
POST /payos/create-link      -> ký quỹ được tạo khi đơn CHƯA trả tiền
PATCH /payments/:id {success}-> người mua tự đánh dấu đơn mình đã trả
PATCH /orders/:id/received   -> tiền được giải ngân ra ví người bán
```

`escrow_hold` tụt xuống −500.000 và rút ra được bằng tiền thật.

Những lỗi còn lại đáng nhớ:

| Lỗi | Hậu quả thật |
|---|---|
| Phí ship kẹt vĩnh viễn trong ký quỹ | huỷ đơn thì người mua mất tiền ship |
| Trả bằng ví không tạo ký quỹ | tiền vào két rồi nằm đó mãi |
| `updateStock` ghi đè (lost update) | bán được hàng nhưng kho tự phục hồi |
| `order_code` trùng | 7–13% đơn/ngày hỏng |
| Danh sách công khai không lọc `status` | hàng bị từ chối nằm đầu trang |
| URL tệp lấy từ header `Host` | link hỏng ghi thẳng vào DB |

### Đợt B — bảo mật (5 lỗi)

- `f021036` — bốn lỗ thủng quyền truy cập: ký quỹ (ai đăng nhập cũng xem được
  doanh thu mọi shop), endpoint GHN tạo đơn thật, giỏ hàng không kiểm tồn/trạng
  thái, link thanh toán cho đơn đã đóng.
- `e943c45` — **BUG-16, giá TOCTOU**: giỏ đọc `product.price` NGOÀI transaction
  rồi mới khoá hàng. Người bán sửa giá đúng trong quãng đó thì đơn chốt theo giá
  cũ mà hoá đơn vẫn tự khớp với chính nó. Đã sửa: đọc lại giá dưới khoá, lệch
  thì **từ chối** (`ConflictException`) kèm cả giá cũ lẫn giá mới — không tự
  tính lại, vì tự tính lại nghĩa là bấm đặt ở 100k rồi bị trừ 150k trong im
  lặng.

### Nền móng dựng kèm

- `src/core/db-exception.filter.ts` — lỗi database nói được tiếng người
  (1062→409, 1451→409, 1452→400, 3819→400, 1406/1264→400), `sqlMessage` chỉ ghi
  log phía máy chủ.
- `src/common/public-url.ts` — URL công khai lấy từ cấu hình, chữ ký hàm **cố ý
  không nhận `req`** để không ai lỡ tay lấy lại từ `Host`.
- 6 migration mới: `escrows.shipping_amount`, 9 CHECK + UNIQUE(order_id,
  seller_id), `timestamp(6)` cho `order_shipments` (lỗi micro-giây thật, dính
  tới keyset epic-2), xoá bảng chết `payos_webhook_logs`,
  `orders.idempotency_key`, 2 index bảng điều khiển.
- 2 cổng tự kiểm mới: `npm run check:constraints` (INSERT dữ liệu xấu thật, có
  3 ca đối chứng — **không** đọc `information_schema`, vì MySQL <8.0.16 nuốt
  lặng CHECK), `npm run check:drift` (ngưỡng 0). Cả hai đã nối vào CI.
- `check:race` thêm R5 — một người bấm "Đặt hàng" 20 lần cùng lúc: trước 20 đơn,
  sau 1 đơn.

---

## 2. Trạng thái nghiệm thu (đo ngày 28/09/2026)

**Chạy được ngay, không cần Docker — đã chạy lại hôm nay, tất cả xanh:**

| Cổng | Kết quả |
|---|---|
| `npm run lint:check` | 916 (884 lỗi + 32 cảnh báo) / mốc 916 ✅ |
| `npm run boundaries:check` | 28 / mốc 28 ✅ |
| `npm run build` | xanh ✅ |
| `npm run openapi:check` | 98 route, 60 schema, **không lệch** ✅ |

**Cần MySQL test (Docker đang tắt trên máy này lúc viết file):**

| Cổng | Lần đo gần nhất |
|---|---|
| `npm test` | 161/161 xanh, 25 suite |
| `npm run check:race` | R1–R5 PASS, `DA_BIET_HONG` trống |
| `npm run check:drift` | 0 dòng lệch |
| `npm run check:constraints` | 0 FAIL (từ 10) |
| `npm run check:index`, `check:boot`, `check:ci` | xanh |
| migration down/up | xanh |

Bốn con số DB ở trên đo trên **đúng cây mã đã commit thành `e943c45`** (chạy
xong rồi mới commit), nên vẫn đúng. Nhưng nếu muốn chắc thì dựng lại và chạy:

```
npm run test:db      # MySQL 3307 + Redis 6380
npm test && npm run check:drift && npm run check:constraints && npm run check:race
```

### Một điều phải nói thẳng về BUG-16

Lần này tôi **làm ngược thứ tự**: viết bản vá trước rồi mới viết `TC-P2-16`,
tức bỏ mất bước 3 của quy trình. Đã chứng minh lại bằng cách tắt riêng đoạn kiểm
giá rồi chạy lại:

```
tắt  -> "Received promise resolved instead of rejected"  (ĐỎ)
bật  -> 1 passed                                          (XANH)
```

Ghi ra đây vì một bài kiểm không chuyển được đỏ→xanh thì không dùng nghiệm thu
được — đúng cái bẫy R1/R4 mà `docs/BAN-GIAO.md` kể.

---

## 3. Việc còn lại, theo thứ tự nên làm

### Chặn đường, không phải việc mã (làm sớm nhất)

1. **Mở PR `fix/luong-mua-ban` → `staging`.** 28 commit đang nằm im. Các commit
   trong `src/money/` **cần Đạt review** — phần tiền là vai A.
2. **Gộp production ↔ staging.** Production đang deploy từ nhánh
   `chore/soat-cau-hinh-payos-firebase`, **đi sau `staging` 142 commit**. Toàn
   bộ 22 bản vá ở trên chưa hề ra production.
3. **Đạt quyết `payos_webhook_logs`**: migration xoá bảng tự chặn nếu còn dòng
   và in sẵn lệnh `mysqldump`. Cần biết production còn bao nhiêu dòng trước khi
   chạy ở đó.

### Đợt C — còn dở (2/5 câu SQL nặng)

- `src/catalog/sitemap/sitemap.service.ts:65`
- cấu trúc bảng dẫn xuất + `DISTINCT` ở `src/catalog/products/products.service.ts:302`
- `npm run sql:audit` **chưa bao giờ chạy trọn** (56 route, quá giờ hai lần; còn
  thiếu tài khoản `buyer/seller/admin@zoldify.com` mật khẩu `123456` mà seed
  không tạo). Ba câu còn lại đã đo bằng `EXPLAIN` trực tiếp thay thế.

### Đợt D — vùng chưa có bài kiểm nào

17 module trắng test. Ưu tiên: `auth`, `wallets`, `admin`. (`carts` nay đã phủ
một phần qua `gio-hang.spec.ts`.)

### Đợt E — hạ tầng

- Redis production đang **tắt** (`api.zoldify.com` trả `"redis":"off"`).
- API nhiều tiến trình + Caddy + `mem_limit` (task #6).

### Một dòng bên Frontend

`profile/products/page.tsx` đang gọi `getBySeller(user.id)`; backend nay đã có
`GET /products/mine`. Đổi một dòng.

### Báo cáo

- Chương II: 18 bảng use-case tiếng Anh, theo `docs/bao-cao/dan-y-bao-cao-50-trang.md`.
- Điền 23 test case vào `TestCaseTemplate.xlsx`.

---

## 4. Ba quyết định nghiệp vụ Đạt đã chốt (đừng hỏi lại)

1. **Phí ship**: người mua và người bán tự trả nhau, **sàn không thu**.
2. **Trả bằng ví → `CONFIRMED`** ngay. "Confirmed là trạng thái đã trả, đợi giao."
3. **COD**: lấy trạng thái từ GHN. *"Đồ án thì khỏi quan tâm cái đó"* — không
   đặt thật được.

---

## 5. Luật bắt buộc khi làm tiếp

Chi tiết ở `CLAUDE.md` và `docs/BAN-GIAO.md`. Tóm lại:

- 6 bước, kể cả việc nhỏ. **Bước 3 — viết bài kiểm trước, chạy, xác nhận nó
  ĐỎ — là bước hay bị làm hình thức nhất.**
- Một lỗi = một commit. `git log` phải kể được thứ tự suy nghĩ.
- Comment tiếng Việt, giải thích **vì sao**, kèm số đo khi dòng đó chặn một lỗi
  cụ thể.
- **Đo, đừng đoán.** Repo có sẵn 9 suite tự kiểm.
- `review_for_claude.md` (untracked, **không đẩy**) do agent khác để lại — bản
  25/08 sai khoảng một nửa. Mở file kiểm từng luận điểm trước khi nhận việc.
- Việc thuộc `src/money/` và bảo mật là của **Đạt (vai A)**. Chọn việc theo HẠN.
